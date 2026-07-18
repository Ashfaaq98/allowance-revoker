// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Allowance {
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IERC721ApprovalForAll {
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/// @title RevokeRegistry
/// @notice A public, verifiable log of token-approval revocations on Monad.
///
/// @dev WHY THIS IS TWO STEPS.
///
/// The naive design is a single `logRevoke(token, spender)` that checks
/// `allowance(msg.sender, spender) == 0` and then credits the caller. That check is
/// worthless: allowance is zero *by default* for every pair that never had an approval,
/// so anyone could call it against unlimited random (token, spender) pairs and mint an
/// unbounded score. It proves nothing happened.
///
/// So a revocation here is proven across two transactions that bracket the user's own
/// `approve(spender, 0)` call:
///
///   1. `arm(...)`     - the contract reads the LIVE allowance itself and requires it to be
///                       NONZERO, then snapshots it on-chain. This is the half the naive
///                       design is missing: proof the approval genuinely existed.
///   2. user revokes   - a normal `approve(spender, 0)` sent straight to the token. Only the
///                       owner can change their own allowance, so this cannot be delegated.
///   3. `confirm(...)` - requires a nonzero snapshot from step 1 AND requires the live
///                       allowance to now be ZERO. Only then is the revoke recorded.
///
/// Both reads are made by this contract against the real token at call time. Neither side
/// can be self-reported, so the resulting log is verifiable by anyone.
///
/// @dev HONEST LIMITS OF `cleanupScore`. This contract proves that a real allowance existed
/// and was really zeroed for the token address you name. It cannot prove that token is
/// *worth* anything - anyone can deploy a worthless ERC-20, approve it, and revoke it.
/// Score is therefore credited at most ONCE per (user, token, spender) triple, so a pair
/// cannot be cycled for points. Any leaderboard built on this should additionally filter to
/// the canonical Monad token list. We do not claim more than the chain can actually prove.
///
/// @dev No owner, no admin keys, no upgradeability, and it never takes custody of anything.
contract RevokeRegistry {
    enum Kind {
        ERC20,
        ERC721
    }

    struct Record {
        address token;
        uint64 revokedAt;
        Kind kind;
        address spender;
    }

    /// @notice Snapshot taken at arm() time. Nonzero means "armed".
    /// @dev For ERC-721 the sentinel value 1 is stored, since approval-for-all is a bool.
    mapping(address user => mapping(bytes32 pair => uint256 amount)) public armedAmount;

    /// @notice Whether a given triple has ever been credited, so it cannot be re-farmed.
    mapping(address user => mapping(bytes32 pair => bool)) public everCounted;

    /// @notice Count of distinct approvals this user has provably revoked.
    mapping(address user => uint256) public cleanupScore;

    mapping(address user => Record[]) private _records;

    event Armed(
        address indexed user, address indexed token, address indexed spender, Kind kind, uint256 amount
    );
    event Revoked(
        address indexed user,
        address indexed token,
        address indexed spender,
        Kind kind,
        uint256 previousAllowance,
        bool scored
    );

    error NotAContract(address target);
    error NoApprovalToRevoke(address token, address spender);
    error NotArmed(address token, address spender);
    error StillApproved(address token, address spender);
    error LengthMismatch();

    // ---------------------------------------------------------------- arm

    /// @notice Snapshot a live, nonzero approval so it can be proven revoked later.
    /// @dev Reverts unless the approval actually exists right now.
    function arm(Kind kind, address token, address spender) public {
        uint256 current = _readApproval(kind, token, msg.sender, spender);
        if (current == 0) revert NoApprovalToRevoke(token, spender);

        armedAmount[msg.sender][_pairKey(kind, token, spender)] = current;
        emit Armed(msg.sender, token, spender, kind, current);
    }

    /// @notice Arm many approvals in a single transaction.
    function armBatch(Kind[] calldata kinds, address[] calldata tokens, address[] calldata spenders)
        external
    {
        if (kinds.length != tokens.length || tokens.length != spenders.length) revert LengthMismatch();
        for (uint256 i = 0; i < tokens.length; ++i) {
            arm(kinds[i], tokens[i], spenders[i]);
        }
    }

    // ------------------------------------------------------------ confirm

    /// @notice Prove a previously-armed approval is now revoked, and record it.
    /// @dev Reverts unless it was armed nonzero AND is now zero on-chain.
    function confirm(Kind kind, address token, address spender) public {
        bytes32 key = _pairKey(kind, token, spender);

        uint256 previous = armedAmount[msg.sender][key];
        if (previous == 0) revert NotArmed(token, spender);

        if (_readApproval(kind, token, msg.sender, spender) != 0) revert StillApproved(token, spender);

        delete armedAmount[msg.sender][key];

        // Credit at most once per triple, so a pair cannot be cycled for points.
        bool scored;
        if (!everCounted[msg.sender][key]) {
            everCounted[msg.sender][key] = true;
            unchecked {
                ++cleanupScore[msg.sender];
            }
            scored = true;
        }

        _records[msg.sender].push(
            Record({token: token, revokedAt: uint64(block.timestamp), kind: kind, spender: spender})
        );

        emit Revoked(msg.sender, token, spender, kind, previous, scored);
    }

    /// @notice Confirm many revocations in a single transaction.
    function confirmBatch(Kind[] calldata kinds, address[] calldata tokens, address[] calldata spenders)
        external
    {
        if (kinds.length != tokens.length || tokens.length != spenders.length) revert LengthMismatch();
        for (uint256 i = 0; i < tokens.length; ++i) {
            confirm(kinds[i], tokens[i], spenders[i]);
        }
    }

    // -------------------------------------------------------------- views

    function getRecords(address user) external view returns (Record[] memory) {
        return _records[user];
    }

    function recordCount(address user) external view returns (uint256) {
        return _records[user].length;
    }

    /// @notice Read the armed snapshot for a triple. Zero means not armed.
    function armedFor(address user, Kind kind, address token, address spender)
        external
        view
        returns (uint256)
    {
        return armedAmount[user][_pairKey(kind, token, spender)];
    }

    /// @notice Live approval amount as this contract sees it. Used by the UI to show the
    ///         same number the contract will enforce against, rather than a cached one.
    function currentApproval(Kind kind, address token, address owner, address spender)
        external
        view
        returns (uint256)
    {
        return _readApproval(kind, token, owner, spender);
    }

    function pairKey(Kind kind, address token, address spender) external pure returns (bytes32) {
        return _pairKey(kind, token, spender);
    }

    // ----------------------------------------------------------- internals

    function _pairKey(Kind kind, address token, address spender) internal pure returns (bytes32) {
        return keccak256(abi.encode(kind, token, spender));
    }

    /// @dev Returns the ERC-20 allowance, or 1/0 for an ERC-721 approval-for-all flag.
    ///      Rejects EOAs outright so a typo'd address fails loudly instead of reading as
    ///      "no approval" and silently passing the confirm() check.
    function _readApproval(Kind kind, address token, address owner, address spender)
        internal
        view
        returns (uint256)
    {
        if (token.code.length == 0) revert NotAContract(token);

        if (kind == Kind.ERC20) {
            return IERC20Allowance(token).allowance(owner, spender);
        }
        return IERC721ApprovalForAll(token).isApprovedForAll(owner, spender) ? 1 : 0;
    }
}

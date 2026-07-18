// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevokeRegistry} from "../src/RevokeRegistry.sol";

/// @dev Emits Approval and exposes metadata so it behaves like a real token to off-chain
///      consumers. The dashboard discovers approvals from Approval EVENTS, not from storage,
///      so a mock that only writes the mapping is invisible to it — which is exactly what an
///      end-to-end run against a local chain turned up.
contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;

    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public balanceOf;

    event Approval(address indexed owner, address indexed spender, uint256 value);

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract MockERC721 {
    string public name = "Mock Collection";
    string public symbol = "MOCKNFT";

    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }
}

contract RevokeRegistryTest is Test {
    RevokeRegistry internal registry;
    MockERC20 internal token;
    MockERC721 internal nft;

    address internal user = makeAddr("user");
    address internal spender = makeAddr("spender");

    uint256 internal constant MAX = type(uint256).max;

    function setUp() public {
        registry = new RevokeRegistry();
        token = new MockERC20();
        nft = new MockERC721();
    }

    // ------------------------------------------------- the attack that motivates the design

    /// @notice The vulnerability in the single-step design: allowance is zero by default for
    ///         pairs that never had an approval, so a bare "is it zero now?" check lets anyone
    ///         mint unbounded score against random addresses. Arming must be required.
    function test_CannotScoreApprovalThatNeverExisted() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(RevokeRegistry.NotArmed.selector, address(token), spender)
        );
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);

        assertEq(registry.cleanupScore(user), 0, "no score for a fabricated revoke");
    }

    function test_CannotFarmScoreAcrossManyRandomSpenders() public {
        for (uint256 i = 1; i <= 25; ++i) {
            // casting to 'uint160' is safe because i is a loop counter bounded by 25
            // forge-lint: disable-next-line(unsafe-typecast)
            address randomSpender = address(uint160(i));
            vm.prank(user);
            vm.expectRevert();
            registry.confirm(RevokeRegistry.Kind.ERC20, address(token), randomSpender);
        }
        assertEq(registry.cleanupScore(user), 0, "farming loop must yield nothing");
    }

    function test_CannotArmAnApprovalThatDoesNotExist() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevokeRegistry.NoApprovalToRevoke.selector, address(token), spender
            )
        );
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
    }

    // ------------------------------------------------------------------------ happy path

    function test_FullLifecycleScoresOnce() public {
        vm.startPrank(user);
        token.approve(spender, MAX);

        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
        assertEq(
            registry.armedFor(user, RevokeRegistry.Kind.ERC20, address(token), spender),
            MAX,
            "snapshot records the real allowance"
        );

        token.approve(spender, 0);
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 1);
        assertEq(registry.recordCount(user), 1);

        RevokeRegistry.Record[] memory records = registry.getRecords(user);
        assertEq(records[0].token, address(token));
        assertEq(records[0].spender, spender);
        assertEq(uint8(records[0].kind), uint8(RevokeRegistry.Kind.ERC20));

        // snapshot is cleared so the same arming cannot be reused
        assertEq(registry.armedFor(user, RevokeRegistry.Kind.ERC20, address(token), spender), 0);
    }

    function test_ConfirmRevertsWhileApprovalIsStillLive() public {
        vm.startPrank(user);
        token.approve(spender, MAX);
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);

        // user armed but never actually revoked
        vm.expectRevert(
            abi.encodeWithSelector(RevokeRegistry.StillApproved.selector, address(token), spender)
        );
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 0);
    }

    /// @dev Partial reduction is not a revoke. Approval must reach exactly zero.
    function test_ReducingAllowanceIsNotARevoke() public {
        vm.startPrank(user);
        token.approve(spender, MAX);
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
        token.approve(spender, 1);

        vm.expectRevert(
            abi.encodeWithSelector(RevokeRegistry.StillApproved.selector, address(token), spender)
        );
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------- anti re-farming

    function test_CyclingTheSamePairDoesNotInflateScore() public {
        vm.startPrank(user);

        for (uint256 i = 0; i < 3; ++i) {
            token.approve(spender, MAX);
            registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
            token.approve(spender, 0);
            registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);
        }
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 1, "same triple credited exactly once");
        assertEq(registry.recordCount(user), 3, "but every event is still logged");
    }

    function test_DistinctSpendersEachScore() public {
        address spenderB = makeAddr("spenderB");

        vm.startPrank(user);
        token.approve(spender, MAX);
        token.approve(spenderB, 500);
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spenderB);
        token.approve(spender, 0);
        token.approve(spenderB, 0);
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spenderB);
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 2);
    }

    function test_ScoreIsPerUser() public {
        address other = makeAddr("other");

        vm.startPrank(user);
        token.approve(spender, MAX);
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
        token.approve(spender, 0);
        registry.confirm(RevokeRegistry.Kind.ERC20, address(token), spender);
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 1);
        assertEq(registry.cleanupScore(other), 0, "one user cannot arm or score for another");
    }

    /// @dev Arming is msg.sender-scoped: A cannot arm using B's live approval.
    function test_CannotArmOnBehalfOfAnotherUser() public {
        vm.prank(user);
        token.approve(spender, MAX);

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevokeRegistry.NoApprovalToRevoke.selector, address(token), spender
            )
        );
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
    }

    // ------------------------------------------------------------------------------ ERC-721

    function test_NftApprovalForAllLifecycle() public {
        vm.startPrank(user);
        nft.setApprovalForAll(spender, true);

        registry.arm(RevokeRegistry.Kind.ERC721, address(nft), spender);
        assertEq(
            registry.armedFor(user, RevokeRegistry.Kind.ERC721, address(nft), spender),
            1,
            "bool approval snapshots as sentinel 1"
        );

        nft.setApprovalForAll(spender, false);
        registry.confirm(RevokeRegistry.Kind.ERC721, address(nft), spender);
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 1);
    }

    /// @dev ERC-20 and ERC-721 keys must not collide even for identical (token, spender).
    function test_KindIsPartOfTheKey() public view {
        assertTrue(
            registry.pairKey(RevokeRegistry.Kind.ERC20, address(token), spender)
                != registry.pairKey(RevokeRegistry.Kind.ERC721, address(token), spender)
        );
    }

    // -------------------------------------------------------------------------------- batch

    function test_BatchArmAndConfirm() public {
        MockERC20 tokenB = new MockERC20();

        RevokeRegistry.Kind[] memory kinds = new RevokeRegistry.Kind[](3);
        address[] memory tokens = new address[](3);
        address[] memory spenders = new address[](3);

        address spenderB = makeAddr("spenderB");
        kinds[0] = RevokeRegistry.Kind.ERC20;
        tokens[0] = address(token);
        spenders[0] = spender;
        kinds[1] = RevokeRegistry.Kind.ERC20;
        tokens[1] = address(tokenB);
        spenders[1] = spenderB;
        kinds[2] = RevokeRegistry.Kind.ERC721;
        tokens[2] = address(nft);
        spenders[2] = spender;

        vm.startPrank(user);
        token.approve(spender, MAX);
        tokenB.approve(spenderB, 1234);
        nft.setApprovalForAll(spender, true);

        registry.armBatch(kinds, tokens, spenders);

        token.approve(spender, 0);
        tokenB.approve(spenderB, 0);
        nft.setApprovalForAll(spender, false);

        registry.confirmBatch(kinds, tokens, spenders);
        vm.stopPrank();

        assertEq(registry.cleanupScore(user), 3);
        assertEq(registry.recordCount(user), 3);
    }

    function test_BatchRejectsLengthMismatch() public {
        RevokeRegistry.Kind[] memory kinds = new RevokeRegistry.Kind[](1);
        address[] memory tokens = new address[](2);
        address[] memory spenders = new address[](2);

        vm.prank(user);
        vm.expectRevert(RevokeRegistry.LengthMismatch.selector);
        registry.armBatch(kinds, tokens, spenders);
    }

    /// @dev A batch is all-or-nothing: one bad entry must not half-credit the user.
    function test_BatchIsAtomic() public {
        RevokeRegistry.Kind[] memory kinds = new RevokeRegistry.Kind[](2);
        address[] memory tokens = new address[](2);
        address[] memory spenders = new address[](2);

        address spenderB = makeAddr("spenderB");
        kinds[0] = RevokeRegistry.Kind.ERC20;
        tokens[0] = address(token);
        spenders[0] = spender;
        kinds[1] = RevokeRegistry.Kind.ERC20;
        tokens[1] = address(token);
        spenders[1] = spenderB; // never approved

        vm.startPrank(user);
        token.approve(spender, MAX);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevokeRegistry.NoApprovalToRevoke.selector, address(token), spenderB
            )
        );
        registry.armBatch(kinds, tokens, spenders);
        vm.stopPrank();

        assertEq(
            registry.armedFor(user, RevokeRegistry.Kind.ERC20, address(token), spender),
            0,
            "first entry rolled back with the batch"
        );
    }

    // ---------------------------------------------------------------------------- sanity

    /// @dev An EOA has no allowance() to read. Without the code-length guard the call would
    ///      return empty data and decode as zero, making confirm() silently succeed.
    function test_RejectsNonContractToken() public {
        address eoa = makeAddr("eoa");
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(RevokeRegistry.NotAContract.selector, eoa));
        registry.arm(RevokeRegistry.Kind.ERC20, eoa, spender);
    }

    function test_CurrentApprovalMatchesToken() public {
        vm.prank(user);
        token.approve(spender, 777);
        assertEq(
            registry.currentApproval(RevokeRegistry.Kind.ERC20, address(token), user, spender), 777
        );
    }

    function testFuzz_ArmSnapshotsExactAllowance(uint256 amount) public {
        amount = bound(amount, 1, MAX);

        vm.startPrank(user);
        token.approve(spender, amount);
        registry.arm(RevokeRegistry.Kind.ERC20, address(token), spender);
        vm.stopPrank();

        assertEq(registry.armedFor(user, RevokeRegistry.Kind.ERC20, address(token), spender), amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RevokeRegistry} from "../src/RevokeRegistry.sol";

/// @dev Deliberately takes no constructor args and hardcodes no addresses - the broadcasting
///      account comes from the --private-key / --account flag. Hardcoding a sender here is the
///      usual cause of "No associated wallet" failures on Monad deploys.
contract DeployScript is Script {
    function run() external returns (RevokeRegistry registry) {
        vm.startBroadcast();
        registry = new RevokeRegistry();
        vm.stopBroadcast();

        console.log("RevokeRegistry deployed to:", address(registry));
        console.log("Chain ID:", block.chainid);
    }
}

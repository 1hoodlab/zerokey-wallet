// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title UsdcTransparentEscrow
 * @notice Holds ERC-20 stakes (typically USDC) at a visible contract balance on-chain.
 * Users fund this contract via standard IERC20.transfer (not pull-based).
 *
 * Transparency model:
 * - Token balance lives in the contract and is observable on explorers.
 * - Only `owner` may move funds back out (`withdraw`). Use a multisig or hardware-wallet
 *   address as owner in production instead of keeping that key on application servers when possible.
 *
 * Important: escrow safety is enforced by whoever controls `owner` and by off-chain bookkeeping
 * (parity with your bot/database). There is no on-chain parimutuel logic here — that stays off-chain MVP.
 */
contract UsdcTransparentEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event EscrowWithdraw(
        IERC20 indexed token,
        address indexed recipient,
        uint256 amount,
        bytes32 memo
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @param memo Optional short reference (poll id hash, payout id hash) hashed off-chain client-side before submit.
     */
    function withdraw(
        IERC20 token,
        address recipient,
        uint256 amount,
        bytes32 memo
    ) external onlyOwner nonReentrant {
        require(recipient != address(0), "UsdcTransparentEscrow: zero recipient");
        require(amount != 0, "UsdcTransparentEscrow: zero amount");
        token.safeTransfer(recipient, amount);
        emit EscrowWithdraw(token, recipient, amount, memo);
    }

    receive() external payable {
        revert("UsdcTransparentEscrow: do not send native coins");
    }
}

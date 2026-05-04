// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MerklePayoutEscrow
 * @notice Holds ERC-20 balances; after `commitPayoutRoot`, winners call `claim` with a Merkle proof.
 * @dev Leaf format (must match off-chain `@openzeppelin/merkle-tree` with same type order):
 *
 *      leaf = keccak256(bytes.concat(keccak256(abi.encode(
 *        payoutId  (bytes32),
 *        recipient (address),
 *        amount    (uint256),
 *        token     (address)
 *      ))))
 *
 * Stake ingress (MVP): plain `IERC20.transfer` into this contract — no on-chain poll accounting here.
 */
contract MerklePayoutEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PayoutRound {
        IERC20 token;
        bytes32 merkleRoot;
        bool committed;
    }

    mapping(bytes32 payoutId => PayoutRound) public payoutRounds;

    mapping(bytes32 claimKey => bool) public claimed;

    event PayoutRootCommitted(
        bytes32 indexed payoutId,
        IERC20 indexed token,
        bytes32 merkleRoot
    );

    event PayoutClaimed(
        bytes32 indexed payoutId,
        IERC20 indexed token,
        address indexed recipient,
        uint256 amount
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice One-shot per `payoutId` (freeze). Use a new `payoutId` if the payout table changes.
     */
    function commitPayoutRoot(
        bytes32 payoutId,
        IERC20 token,
        bytes32 merkleRoot
    ) external onlyOwner {
        PayoutRound storage round = payoutRounds[payoutId];
        require(!round.committed, "MerklePayoutEscrow: root already committed");
        require(address(token) != address(0), "MerklePayoutEscrow: zero token");
        require(merkleRoot != bytes32(0), "MerklePayoutEscrow: zero root");

        round.token = token;
        round.merkleRoot = merkleRoot;
        round.committed = true;

        emit PayoutRootCommitted(payoutId, token, merkleRoot);
    }

    /** @dev Mirrors off-chain leaf hashing for tests and tooling (staticcall-friendly). */
    function leafHash(
        bytes32 payoutId,
        address recipient,
        uint256 amount,
        IERC20 token
    ) public pure returns (bytes32) {
        return
            keccak256(
                bytes.concat(keccak256(abi.encode(payoutId, recipient, amount, address(token))))
            );
    }

    function claim(
        bytes32 payoutId,
        IERC20 token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        PayoutRound memory round = payoutRounds[payoutId];
        require(round.committed, "MerklePayoutEscrow: not committed");
        require(address(round.token) == address(token), "MerklePayoutEscrow: token mismatch");

        bytes32 leaf = leafHash(payoutId, msg.sender, amount, token);
        require(
            MerkleProof.verifyCalldata(merkleProof, round.merkleRoot, leaf),
            "MerklePayoutEscrow: invalid proof"
        );

        bytes32 key = keccak256(abi.encode(payoutId, msg.sender, amount));
        require(!claimed[key], "MerklePayoutEscrow: already claimed");
        claimed[key] = true;

        token.safeTransfer(msg.sender, amount);
        emit PayoutClaimed(payoutId, token, msg.sender, amount);
    }

    receive() external payable {
        revert("MerklePayoutEscrow: no native deposits");
    }
}

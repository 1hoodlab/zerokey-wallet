/* eslint-env mocha */

import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { assert } from "chai";
import { ethers } from "hardhat";

import type { MerklePayoutEscrow, MockERC20 } from "../typechain-types";

describe("MerklePayoutEscrow", () => {
  const leafEncoding = ["bytes32", "address", "uint256", "address"] as const;

  async function deployFixture(): Promise<{
    escrow: MerklePayoutEscrow;
    mockToken: MockERC20;
    ownerSigner: ethers.Signer;
    aliceSigner: ethers.Signer;
    bobSigner: ethers.Signer;
  }> {
    const factory = await ethers.getContractFactory("MerklePayoutEscrow");
    const [ownerSigner, aliceSigner, bobSigner] = await ethers.getSigners();
    const escrow = await factory.deploy(await ownerSigner.getAddress());
    await escrow.waitForDeployment();

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const mockToken = (await tokenFactory.deploy("MockUSD", "MUSD")) as MockERC20;
    await mockToken.waitForDeployment();

    return { escrow, mockToken, ownerSigner, aliceSigner, bobSigner };
  }

  it("allows claim after frozen root when proof and balance are correct", async () => {
    const { escrow, mockToken, ownerSigner, aliceSigner, bobSigner } = await deployFixture();
    const tokenAddress = await mockToken.getAddress();
    const escrowAddress = await escrow.getAddress();

    const payoutId = ethers.id("payout:test-1");
    const aliceAddr = await aliceSigner.getAddress();
    const bobAddr = await bobSigner.getAddress();

    const amountAlice = ethers.parseUnits("99", 6);
    const amountBob = ethers.parseUnits("1", 6);

    const treeValues: [string, string, bigint, string][] = [
      [payoutId, aliceAddr, amountAlice, tokenAddress],
      [payoutId, bobAddr, amountBob, tokenAddress],
    ];

    const standardsTree = StandardMerkleTree.of(treeValues, leafEncoding);
    const merkleRoot = standardsTree.root;

    const totalFund = amountAlice + amountBob;
    await mockToken.mint(escrowAddress, totalFund);

    await escrow.connect(ownerSigner).commitPayoutRoot(payoutId, tokenAddress, merkleRoot);

    const proofAlice = standardsTree.getProof([payoutId, aliceAddr, amountAlice, tokenAddress]);
    await escrow
      .connect(aliceSigner)
      .claim(payoutId, tokenAddress, amountAlice, proofAlice);

    const proofBob = standardsTree.getProof([payoutId, bobAddr, amountBob, tokenAddress]);
    await escrow.connect(bobSigner).claim(payoutId, tokenAddress, amountBob, proofBob);

    assert.equal(await mockToken.balanceOf(aliceAddr), amountAlice);
    assert.equal(await mockToken.balanceOf(bobAddr), amountBob);
  });

  it("reverts on double claim", async () => {
    const { escrow, mockToken, ownerSigner, aliceSigner } = await deployFixture();
    const tokenAddress = await mockToken.getAddress();
    const escrowAddress = await escrow.getAddress();

    const payoutId = ethers.id("payout:double");
    const aliceAddr = await aliceSigner.getAddress();
    const amount = 50n;

    const treeValues: [string, string, bigint, string][] = [
      [payoutId, aliceAddr, amount, tokenAddress],
    ];
    const standardsTree = StandardMerkleTree.of(treeValues, leafEncoding);

    await mockToken.mint(escrowAddress, amount);
    await escrow.connect(ownerSigner).commitPayoutRoot(payoutId, tokenAddress, standardsTree.root);

    const proof = standardsTree.getProof([payoutId, aliceAddr, amount, tokenAddress]);
    await escrow.connect(aliceSigner).claim(payoutId, tokenAddress, amount, proof);

    await assert.isRejected(
      escrow.connect(aliceSigner).claim(payoutId, tokenAddress, amount, proof),
      /already claimed/,
    );
  });

  it("reverts when proof does not match committed root", async () => {
    const { escrow, mockToken, ownerSigner, aliceSigner } = await deployFixture();
    const tokenAddress = await mockToken.getAddress();
    const escrowAddress = await escrow.getAddress();
    const payoutId = ethers.id("payout:bad-proof");
    const aliceAddr = await aliceSigner.getAddress();
    const amount = 10n;

    const treeValuesValid: [string, string, bigint, string][] = [
      [payoutId, aliceAddr, amount, tokenAddress],
    ];
    const validTree = StandardMerkleTree.of(treeValuesValid, leafEncoding);

    await mockToken.mint(escrowAddress, amount);
    await escrow.connect(ownerSigner).commitPayoutRoot(payoutId, tokenAddress, validTree.root);

    const treeValuesTampered: [string, string, bigint, string][] = [
      [payoutId, aliceAddr, amount + 1n, tokenAddress],
    ];
    const tamperedTree = StandardMerkleTree.of(treeValuesTampered, leafEncoding);

    const badProof = tamperedTree.getProof([
      payoutId,
      aliceAddr,
      amount + 1n,
      tokenAddress,
    ]);

    await assert.isRejected(
      escrow.connect(aliceSigner).claim(payoutId, tokenAddress, amount + 1n, badProof),
      /invalid proof/,
    );
  });
});

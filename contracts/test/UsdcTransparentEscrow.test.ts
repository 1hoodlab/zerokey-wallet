import { expect } from "chai";
import { ethers } from "hardhat";

describe("UsdcTransparentEscrow", () => {
  it("deploys with owner set", async () => {
    const [owner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("UsdcTransparentEscrow");
    const escrow = await Factory.deploy(owner.address);
    await escrow.waitForDeployment();

    await expect(await escrow.owner()).to.equal(owner.address);
  });
});

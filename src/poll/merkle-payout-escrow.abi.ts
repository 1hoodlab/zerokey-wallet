/** Minimal ABI fragments for contracts/contracts/MerklePayoutEscrow.sol */
export const merklePayoutEscrowAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'payoutId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      {
        name: 'merkleProof',
        type: 'bytes32[]',
      },
    ],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'payoutId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    name: 'commitPayoutRoot',
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

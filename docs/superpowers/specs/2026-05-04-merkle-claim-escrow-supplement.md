# Merkle-based claim escrow — design supplement (polls / parimutuel)

- **Ngày**: 2026-05-04
- **Status**: Draft supplement (không thay thế `2026-05-04-telegram-binary-polls-design.md`; chọn **một trong hai** hướng payout hoặc giai đoạn sau)
- **Goal:** Sau khi đóng phiên và có **bảng chia thưởng** off-chain, backend **commit `merkleRoot` lên contract**; user **claim** với **proof**; contract **tự verify** leaf thuộc root và **chi trả USDC** trong phạm vi **số tiền và địa chỉ đã được commit**.

---

## 1. Trust model (đọc kỹ để tránh nhầm “phi tập trung”)

- Contract **không** biết “truth” thế giới hay “cửa nào đúng thực tế”. Nó chỉ biết: **một root đã được chấp nhận** và **một leaf (địa chỉ + số tiền …) có hợp lệ không**.
- Ai **tin tưởng** `merkleRoot` (và identity ký `setPayoutRoot`) = **tin đội ngũ/back-end/creator đã commit đúng bảng chia thưởng**. So với **`owner withdraw`** thuần: **hành vi gian lận chuyển từ “rút tuỳ ý” sang “commit root sai / cắt người không có trong cây”** — vẫn cần governance (multisig, audit log, freeze rule).

**Cải thiện UX minh bạch:** mọi người có thể **audit off-chain** danh sách leaves, **tự build lại root** và đối chiếu tx `setPayoutRoot` on-chain.

---

## 2. End-to-end flow (gợi ý)

| Bước | On-chain | Off-chain |
|------|----------|-----------|
| Stake | User (hoặc bot ký hộ SA) gửi **USDC vào contract** (xem §3) | Mirror `VoteIntent` như MVP |
| Close / resolve | (tuỳ chọn) event mirror | Parimutuel + danh sách `(recipient, amountWei)` winners |
| Publish payout | **`setPayoutRoot(payoutId, root, ...) — một lần / freeze`** | Build Merkle tree, lưu proof theo user |
| Claim | **`claim(...)`**: verify proof, transfer USDC ra | Bot **`/claim_poll`** có thể gửi proof trong tx calldata |

---

## 3. Thu tiền (stake ingress) — hai cửa thiết kế

### 3.A Giữ MVP tối thiểu (ít đổi contract)

- Stake vẫn là **`transfer(contract, amount)`** từ ví user như hiện tại *(không cần `depositFor`)*.
- Poll / cửa / parimutuel **chỉ ở DB**; pool USDC chỉ là **aggregate balance** của contract — **risk:** khó chứng minh on-chain stake nào thuộc poll nào *trừ khi* bổ sung event/index (§3.B).

### 3.B Ingress có gắn `pollId` (rõ ràng hơn, contract nặng hơn)

- `depositSides(pollId, side, amount)` dùng `transferFrom`: user `approve` contract rồi gọi; emit `Stake(pollId, msg.sender, side, amount, ...)`.
- Phù hợp audit on-chain nhưng **đổi UX** và contract.

**Khuyến nghị giai đoạn 1 Merkle payout:** làm **§3.A** để tái dùng flow bot hiện tại; sau nếu cần audit stake thì nâng **§3.B**.

---

## 4. Leaf format (chuẩn hóa — tránh lỗi proof)

Mục tiêu: leaf **duy nhất** cho mỗi dòng payout; hỗ trợ **OpenZeppelin** `MerkleProof.verify` với **double hashing** (chống second-preimage tầm thường).

**Đề xuất leaf (off-chain & on-chain thống nhất):**

```text
leaf = keccak256(bytes.concat(keccak256(abi.encode(
  payoutId,      // bytes32: ví dụ keccak256(pollUuid + resolutionNonce)
  recipient,     // address: địa chỉ SA user trên chain đó (đúng ví nhận)
  amount,        // uint256: USDC base units
  token          // address: USDC contract (tránh nhầm token)
))))
```

- **`payoutId`:** xác định **một lần “mở thưởng”**; nếu resolve lại (sai policy) cần **`resolutionNonce`** mới → **cây mới** — **không** ghi đè root cũ (xem §6).
- **`recipient`:** phải là **đúng** địa chỉ mà user claim (thường SA từ `deriveAddress(telegramId)`).
- Không đưa `telegramId` on-chain nếu không cần; map **Telegram → recipient** ngoài chain.

**Cây Merkle:** sort leaves (sorted pairs) như generator OZ **`@openzeppelin/merkle-tree`** để proof ổn định; backend lưu `proof[]` **per `(payoutId, recipient)`**.

---

## 5. Chống double-claim

**Yêu cầu:** không ai claim **hai lần** cùng một quyền nhận (cùng `amount`/cùng `payout`/cùng `recipient`) sau khi root đã set.

### 5.1 Đơn giản (khuyến nghị MVP)

```text
consumptionKey = keccak256(abi.encode(payoutId, recipient, amount))
mapping(bytes32 => bool) claimed;
```

- Trong `claim(payoutId, recipient, amount, proof[])`: sau khi proof OK và `recipient == msg.sender`, set `claimed[key] = true`.
- Giả định: **mỗi user tối đa một payout row** trong một `payoutId`. Nếu **nhiều dòng payout** cho cùng recipient (chia nhỏ nhiều gói), dùng **nhiều `(amount_i)` trong cây** hoặc thêm **`claimIndex`** vào leaf:
  ```text
  leaf = … encode(payoutId, recipient, amount, token, claimNonce)
  ```
  và **`claimed`** theo **`leafHash`** (hoặc `keccak(leaf)` không double outer hash — chỉ cần thống nhất).

### 5.2 Một alternate

- **`claimed[payoutId][recipient]`** bool (nếu mỗi recipient **một amount** cố định cho payout đó).

**Quyết định:** nếu spec parimutuel của bạn **một ví — một payout** trong mỗi lần resolve: **§5.1 với một amount** là đủ.

---

## 6. Publish root — một lần hay cập nhật? Freeze?

| Chiến lược | Hành vi | Ghi chú |
|------------|---------|---------|
| **Freeze sau set** *(khuyến nghị)* | `setPayoutRoot(payoutId, root, token, totalClaimsHash)` chỉ được gọi **khi `root == 0` → non-zero`; revert nếu gọi lại | Tránh creator đổi cây sau khi người thắng đã nhìn proof |
| **Replaceable root** *(không khuyến nghị)* | Cho phép admin set lại → user phải tin admin vô điều kiện | Chỉ dùng nếu có **timelock + challenge** |

**Bắt buộc trong spec:** **`payoutId` unique cho mỗi lần commit** Nếu cần “sửa danh sách”, dùng **`payoutId_v2`** mới chứ không overwrite.

Tuỳ chọn bảo vệ thêm:

- **`notBefore` timestamp** trong contract trước khi được claim (ít cần nếu root chỉ publish sau đủ quorum).
- **Pull USDC vào escrow trước:** contract phải **đủ balance** để chi; backend kiểm tra `sum(amounts) ≤ balance`** trước khi set root (fail-safe off-chain).

---

## 7. Contract surface (concept)

```solidity
event PayoutCommitted(bytes32 indexed payoutId, IERC20 indexed token, bytes32 root, uint256 totalPayoutWei);
event PayoutClaimed(bytes32 indexed payoutId, IERC20 indexed token, address indexed recipient, uint256 amount);

function setPayoutRoot(
  bytes32 payoutId,
  IERC20 token,
  bytes32 merkleRoot
) external /* onlyOwner or onlyRegistrar */;

function claim(
  bytes32 payoutId,
  IERC20 token,
  uint256 amount,
  bytes32[] calldata merkleProof
) external nonReentrant;
```

- **`onlyOwner`** có thể thay = **`REGISTER_ROLE`** multisig để chỉ chức năng “đăng ký payout”.
- **Token:** truyền vào để **`claim`** transfer đúng `USDC` address on BSC testnet.

---

## 8. Relation tới **`UsdcTransparentEscrow`** hiện có

| | `UsdcTransparentEscrow` | Merkle claim vault |
|--|--------------------------|---------------------|
| Payout | `withdraw(token,to,amt,memo)` bởi owner | **`claim`** bởi user với proof |
| Key risk | Ai có owner key có thể rút | Ai set root sai quyết định danh sách; user chỉ claim được nếu nằm trong cây |

**Hardhat:** nên **`MerklePayoutEscrow.sol` mới** (hoặc `ParimutuelEscrowV2.sol`) để không phá escrow đơn giản đang có; tái dùng OZ libs.

---

## 9. Backend / bot deltas (so MVP plan hiện tại)

1. Sau `resolve_poll`: compute **winners**, build **Merkle tree**, **`setPayoutRoot` tx** (multisig / operator).
2. Lưu `merkle_proof` **per telegramId → recipient** trong DB *(JSON uint256 words)* để **`/claim_poll`** assemble calldata.
3. Bot hoặc relayer có thể **`claim` behalf** user **chỉ nếu** user ký/session — MVP thường **user không ký EIP-712** ⇒ **backend gửi `claim` không được** unless operator pays **for** user's SA abstraction — phức tạp. **Thực tế MVP:** **`msg.sender`** phải là **recipient** ⇒ cần **user tx** *(Telegram không ký được trực tiếp)* → **Giảm phạm vi:** bot chỉ đưa **link / instruction** để đăng nhập ví? **Hoặc** với custodial SA hiện tại của zerokey-wallet, **backend ký USEROP** là user SA gọi `claim` là recipient — đây là **ưu điểm** của app custodial có thể gói **`claim`** giống `send`.

Ghi vào phase-2 của implementation plan.

---

## 10. Kiểm thử bắt buộc (contract)

- Proof đúng / sai / replay / double claim
- Sai `amount`/`recipient`/`payoutId`/`token`
- Root chỉ set một lần
- Balance contract không đủ → revert rõ message

---

**Next:** Nếu bạn approve supplement này, bước kế là **writing-plans** nhánh “`MerklePayoutEscrow` + Nest `PollMerkleService`” hoặc merge vào một plan rollout theo phase (Owner withdraw trước, Merkle sau).

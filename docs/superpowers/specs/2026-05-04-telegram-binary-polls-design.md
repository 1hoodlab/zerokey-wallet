# Telegram binary prediction polls — design spec

- **Ngày**: 2026-05-04
- **Status**: Draft for review
- **Project**: zerokey-wallet
- **Scope**: Module “Poll” trong bot — poll **nhị phân**, **parimutuel**, escrow USDC cố định do app quản (mirror DB), **`VoteIntent`/session** trước khi OTP chuyển tiền (Hướng 2 brainstorm).
- **Token**: USDC trên **`Network`** (poll được pin `network_id`).
- **Non-goals**: AMM/LMSR, oracle phi tập trung (Polymarket-style), NegRisk/multi-market, slug web UI.

---

## 1. Bối cảnh và mục tiêu

Tiếp tục pattern hiện có: NestJS application context + grammY, Prisma + PostgreSQL, chuyển USDC có OTP giống `/send`. Module mới cho phép **creator** mở poll **hai cửa**, người tham gia đặt **stake** bằng chuyển USDC vào **địa chỉ escrow của app**. Sau khi **`/close_poll`**, creator **`/resolve_poll`** chỉ cửa thắng; nền tảng tính **parimutuel** và participant **`/claim_poll`** để nhận USDC từ escrow về **smart account** của họ (cùng network).

**Tin cậy:** creator được coi như **house** cho **kết quả** (off-chain). **Không** có bằng chứng on-chain cho “đúng/sai thực tế” — đây là sản phẩm **tin cậy creator + tin cậy app** (escrow key), phù hợp demo/testnet; mainnet yêu cầu rủi ro pháp lý và hardening ngoài scope.

### Mục tiêu rõ ràng

- **`/create_poll`**: tạo poll `OPEN` (hai nhãn cửa + tiêu đề), gắn **network hiện tại của creator**.
- **`/poll <id>`**: xem trạng thái + tổng stake từng cửa (public đọc được).
- **`/vote_poll`**: flow **session** `VoteIntent` → user confirm → initiate transfer → OTP → on-chain confirm → `STAKE_CONFIRMED`.
- **`/close_poll`**: creator khóa vote; snapshot thời điểm `closedAt`.
- **`/resolve_poll`**: creator chọn cửa thắng → `RESOLVED` + materialize bảng **payout** (hoặc tương đương).
- **`/claim_poll`**: participant rút phần thắng từ escrow về SA user.

### Phi mục tiêu (MVP)

- Nhiều hơn **hai** outcome; thị trường thứ cấp / bán lại vị thế.
- Phí nền tảng trích từ pool (có thể thêm sau bằng env `POLL_FEE_BPS`).
- Oracle/UMA, smart contract điều phối pool.
- Giao diện ngoài Telegram.

---

## 2. Quyết định đã chốt (brainstorm log)

| # | Decision | Ghi chú |
|---|----------|---------|
| B1 | **Creator = house** cho resolution | Chỉ creator resolve; participant chấp nhận rủi ro gian lận creator |
| B2 | **Stake on-chain + OTP** | Giống `/send`, recipient = **escrow address** env |
| B3 | **Escrow cố định** | Một `POLL_USDC_ESCROW_ADDRESS` (per network hoặc global + validate chain) |
| B4 | **Poll nhị phân** | Hai cửa `SIDE_A` / `SIDE_B` (nhãn hiển thị tùy creator) |
| B5 | **Parimutuel nhị phân** | Bên thua bù trừ cho bên thắng theo tỷ lệ stake |
| B6 | **`/close_poll` bắt buộc trước `/resolve_poll`** | Chặn vote mới; stake hợp lệ nếu **tx confirm ≤ `closedAt`** |
| B7 | **UX vote = Hướng 2** | `VoteIntent` DB + bước confirm trước khi tạo `PendingTransfer` |

---

## 3. Lifecycle & state machine

### 3.1 `Poll.state`

- **`OPEN`**: cho phép tạo `VoteIntent` mới và hoàn tất stake (subject rules confirm time).
- **`CLOSED`**: không vote mới; `closedAt` set.
- **`RESOLVED`**: `winningOutcome` set; payout rows có thể claim.

Chuyển trạng thái:

- `OPEN` → `CLOSED`: lệnh creator **`/close_poll`**.
- `CLOSED` → `RESOLVED`: lệnh creator **`/resolve_poll <A|B>`** (map tới `SIDE_A`/`SIDE_B`).

### 3.2 `VoteIntent.status`

| Status | Ý nghĩa |
|--------|---------|
| `DRAFT` | Đã mở phiên, chưa confirm gửi tiền |
| `AWAITING_ESCROW_PAYMENT` | Đã có `pendingTransfer`, chờ OTP + confirm chain |
| `STAKE_CONFIRMED` | Transfer `CONFIRMED`, stake được tính vào ledger nếu thỏa cutoff |
| `EXPIRED` | Quá TTL intent |
| `FAILED` | Transfer không thành công / expiry / huỷ nội phần được định nghĩa |
| `CANCELLED` | User/agent huỷ trước khi có transfer |
| `BLOCKED_CLOSED` *(hoặc tên tương đương)* | Đặt cố định khi đã CLOSE mà intent còn ở giai đoạn không hợp lệ để báo UX rõ |

**Quy tắc stake hợp lệ vào pool:** chỉ các `VoteIntent` chuyển sang `STAKE_CONFIRMED` và có **`stakeConfirmedAt ≤ Poll.closedAt`**, và `PendingTransfer` khớp: **recipient = escrow**, **network = Poll.networkId**, amount khớp intent.

### 3.3 Claim sau resolve

Materialize **`PollWinnerPayout`** (tên logic): một dòng `(poll_id, telegram_id, amount_owed)` cho mỗi winner có `amount_owed > 0`.

- **`claim` không OTP trong MVP**: chỉ Telegram identity + deterministic debt (giảm ma sát); có thể bật OTP sau nếu yêu cầu parity với ingress.

---

## 4. Công thức parimutuel và làm tròn

Gọi tổng stake (base units, sau cutoff) của cửa thắng **`W`**, cửa thua **`L`**.

- **`payout_raw_i = stake_i_win * (W + L) / W`** (phép chia số nguyên: **`floor`** khi chia cuối cùng từng user).
- Khi chỉ **`floor`** từng `payout_i`, tổng có thể < `W+L` → **dust** `remainder`.

**Quyết định MVP (explicit):**

- **`remainder`** (base units) **ở lại escrow** và được ghi nhận nội bộ là **unallocated dust** của poll đó *(không tự động chia thêm trong MVP)* OR **ghi log** và coi là phí escrow vô hình — chọn **`remainder`** **ở lại escrow** để đơn giản hóa triển khai.

**Điều kiện guard resolve:** chỉ resolve khi **`W > 0`**. Trường hợp **toàn stake một cửa** (`L = 0`): `payout_i = stake_i` (identity).

---

## 5. Kiến trúc và luồng tiền

### 5.1 Vào escrow (stake)

1. User chạy `/vote_poll` → bot tạo `VoteIntent` `DRAFT`.
2. User confirm → `AWAITING_ESCROW_PAYMENT` → `TransferService.initiate(...)` với recipient `POLL_USDC_ESCROW_ADDRESS`, `network` = poll network.
3. User nhập OTP → giống hiện tại.
4. On `CONFIRMED`: cập nhật intent **`STAKE_CONFIRMED`**, set `stakeConfirmedAt`. Việc tính `W/L` chỉ áp các intent thỏa **§3.2** (trong đó **`stakeConfirmedAt ≤ Poll.closedAt`** và transfer khớp escrow/network/amount)—có thể tính **lazy lúc `resolve`** từ query, không cần ledger vật lý riêng nếu query đủ nhanh với MVP.

**Lưu ý:** `PendingTransfer` (hoặc bảng liên kết) cần **liên kết ngược** tới `voteIntentId` / `pollId` để audit — chi tiết implementation chọn **cột nullable trên `PendingTransfer`** hoặc bảng junction; spec không chốt tên enum DB.

### 5.2 Ra escrow (payout)

- Service độc lập **`PollPayoutService`** (tên làm việc) hoặc tương đương:
  - Đọc `PollWinnerPayout` `UNCLAIMED`.
  - Ký & broadcast **`ERC20.transfer`** USDC **từ ví điều khiển escrow** tới **`deriveAddress(userTelegramId, network)`**.
- **Điều kiện env:** private key của escrow khớp `POLL_USDC_ESCROW_ADDRESS` (không được hardcode; đọc secrets).

Transfer ra **không** dùng luồng OTP của user ingress; chỉ **`/claim`** kích hoạt.

---

## 6. Bot commands (MVP)

| Command | Ai | Hành vi |
|---------|-----|---------|
| `/create_poll` | creator | Conversation ngắn hoặc 1–2 message: labels A/B + title; khởi tạo `OPEN` |
| `/poll <id>` | ai | Chi tiết + tổng stake hai cửa + state |
| `/vote_poll` | participant | Session Hướng 2 như §3 |
| `/close_poll <id>` | creator | `CLOSED` + timestamp |
| `/resolve_poll <id> <A\|B>` | creator | `RESOLVED` + materialize payout |
| `/claim_poll <id>` | participant | Xử lý payout chưa trả |

Bổ sung **`/help`** với các dòng ngắn.

---

## 7. Schema Prisma (sketch MVP)

Đây là **vùng chỉnh sửa dự kiến** trong implementation — định nghĩa **entity**, không ép khớp 1–1 migrate cho tới implementation plan.

```prisma
enum PollState {
  OPEN
  CLOSED
  RESOLVED
}

enum PollSide {
  SIDE_A
  SIDE_B
}

enum VoteIntentStatus {
  DRAFT
  AWAITING_ESCROW_PAYMENT
  STAKE_CONFIRMED
  EXPIRED
  FAILED
  CANCELLED
  BLOCKED_CLOSED
}

enum PollPayoutStatus {
  UNCLAIMED
  PROCESSING
  PAID
}

model Poll {
  id                 String    @id @default(uuid())
  creatorTelegramId  BigInt    @map("creator_telegram_id")
  networkId          String    @map("network_id")
  network            Network   @relation(fields: [networkId], references: [id])
  title              String
  sideALabel         String    @map("side_a_label")
  sideBLabel         String    @map("side_b_label")
  state              PollState
  closedAt           DateTime? @map("closed_at")
  resolvedAt         DateTime? @map("resolved_at")
  winningOutcome     PollSide? @map("winning_outcome")
  createdAt          DateTime  @default(now()) @map("created_at")

  voteIntents        VoteIntent[]
  winnerPayouts      PollWinnerPayout[]

  @@map("polls")
}

model VoteIntent {
  id                  String           @id @default(uuid())
  pollId              String           @map("poll_id")
  poll                Poll             @relation(fields: [pollId], references: [id])
  telegramId          BigInt           @map("telegram_id")
  outcome             PollSide
  amountBaseUnits     String           @map("amount_base_units")
  status              VoteIntentStatus
  pendingTransferId   String?          @map("pending_transfer_id")
  pendingTransfer     PendingTransfer? @relation(fields: [pendingTransferId], references: [id])
  expiresAt           DateTime         @map("expires_at")
  stakeConfirmedAt    DateTime?        @map("stake_confirmed_at")

  @@index([pollId, status])
  @@index([telegramId])
  @@map("vote_intents")
}

model PollWinnerPayout {
  id                 String           @id @default(uuid())
  pollId             String           @map("poll_id")
  poll               Poll             @relation(fields: [pollId], references: [id])
  telegramId         BigInt           @map("telegram_id")
  amountOwedBaseUnits String           @map("amount_owed_base_units")
  status             PollPayoutStatus
  paidAt             DateTime?        @map("paid_at")
  outboundTxHash     String?          @map("outbound_tx_hash")

  @@unique([pollId, telegramId])
  @@map("poll_winner_payouts")
}
```

**Quan hệ `PendingTransfer`:** thêm FK tùy chọn **`voteIntentId`** hoặc ngược `VoteIntent.pendingTransferId` đã có — implementation chọn một chiều duy nhất để không circular migration phức tạp.

---

## 8. Failure modes & invariant

| Tình huống | Xử lý MVP |
|------------|-----------|
| Transfer confirm **sau** `closedAt` | Intent **không** vào pool thắng/thua ledger; báo user (stuck USDC escrow) có thể cần **hỗ trợ thủ công** *(ghi rõ là giới hạn MVP)* |
| `W === 0` khi resolve | **Từ chối resolve** |
| Winner amount < gas buffer | ERC20 không tốn gas như ETH nhưng vẫn cần ETH/native cho gas payer — escrow phải giữ ETH trên chain; không giải trong spec USDC *(runbook chi tiết trong implementation)* |
| Double claim | `PROCESSING`/unique constraint `(poll_id, telegram_id)` + optimistic lock hoặc idempotency |
| Creator resolve sai có chủ đích | **Hoàn toàn off-chain ethics** — không mitigation kỹ thuật trong MVP |

---

## 9. Testing (bắt buộc tối thiểu)

- **Đơn vị**: công thức parimutuel với các vector `W`, `L`, nhiều winner; edge `L=0`, `W > 0` nhỏ; làm tròn + `remainder` policy.
- **Đơn vị**: transitions state `Poll`, `VoteIntent` (mock Prisma hoặc service pure).
- **Tích hợp có thể mock chain**: initiation stake gắn intent; payout service với ví mock *(defer nếu plan chia nhỏ)*.

---

## 10. Relation to Polymarket PDF (explicit non-fit)

Review “Algorithms of Polymarket” bàn **AMM (LMSR), order book hybrid, combinatorial arbitrage, optimistic oracle**. Module này **không** triển khai các cơ chế đó; chỉ mượn **ý tưởng** “có event, có stake, có settlement” với **parimutuel đơn giản** và **resolution tin cậy creator**.

---

## 11. Self-review checklist (author)

- **Placeholder scan:** không còn TBD quan trọng ngoài “ESCROW gas ETH” (đã ghi là runbook phụ).
- **Internal consistency:** close-before-resolve, stake cutoff, `W>0` guard thống nhất.
- **Scope:** một module poll binary + payout; không mở rộng AMM/oracle.
- **Ambiguity:** đã chốt **remainder → escrow**; đã chốt **claim không OTP** MVP.

---

**Next step after review:** follow **writing-plans** skill to produce `plans/2026-05-04-…-implementation-plan.md` with ordered tasks (Prisma migration, poll module, handlers, payout service, tests).
Content is ready; user must approve this file before implementation.

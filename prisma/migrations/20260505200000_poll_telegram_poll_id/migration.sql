-- AlterTable
ALTER TABLE "polls" ADD COLUMN "telegram_poll_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "polls_telegram_poll_id_key" ON "polls"("telegram_poll_id");

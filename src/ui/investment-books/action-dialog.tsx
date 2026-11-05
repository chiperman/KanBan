import { type InvestmentBookId } from "@/domain/investment-books";
import { FinancialRecordDialog, type FinancialRecordDialogProps } from "@/ui/financial-record-dialog";

export function ActionDialog({
  checkBookId,
  checkHref,
  ...props
}: Omit<FinancialRecordDialogProps, "titleId" | "checkHref"> & {
  checkBookId: InvestmentBookId;
  checkHref?: string;
}) {
  return (
    <FinancialRecordDialog
      {...props}
      titleId="book-action-title"
      checkHref={checkHref ?? `/performance?book=${checkBookId}&view=records&recordFilter=all`}
    />
  );
}

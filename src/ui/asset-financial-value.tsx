import type { ReactNode } from "react";

/** 金融读数使用点阵，币种单位保留为小号等宽注解。 */
export function AssetFinancialValue({
  children,
  unit,
}: {
  children: ReactNode;
  unit?: string;
}) {
  return (
    <>
      <span className="asset-financial-number">{children}</span>
      {unit ? <span className="asset-financial-unit"> {unit}</span> : null}
    </>
  );
}

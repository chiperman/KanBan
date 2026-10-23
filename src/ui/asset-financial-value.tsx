import type { CSSProperties, ReactNode } from "react";

/** 金融读数使用点阵，币种单位保留为小号等宽注解。 */
export function AssetFinancialValue({
  children,
  className,
  style,
  unit,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  unit?: string;
}) {
  return (
    <>
      <span className={["asset-financial-number", className].filter(Boolean).join(" ")} style={style}>
        {children}
      </span>
      {unit ? <span className="asset-financial-unit"> {unit}</span> : null}
    </>
  );
}

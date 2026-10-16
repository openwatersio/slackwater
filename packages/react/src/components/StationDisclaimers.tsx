export interface StationDisclaimersProps {
  disclaimers?: string;
  className?: string;
}

export function StationDisclaimers({ disclaimers, className }: StationDisclaimersProps) {
  if (!disclaimers) return null;

  return <p className={`m-0 text-[11px] text-(--sw-foam)/62 ${className ?? ""}`}>{disclaimers}</p>;
}

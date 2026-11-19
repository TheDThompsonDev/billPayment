import { label } from "@/lib/utils";
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      <i />
      {label(value)}
    </span>
  );
}

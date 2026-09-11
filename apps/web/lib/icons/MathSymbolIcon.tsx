import { mathSymbolPreview } from "./math-symbols";
export function MathSymbolIcon({ id }: { id: string }) {
  const html = mathSymbolPreview(id);
  return html ? (
    <span
      className="math-symbol-icon"
      data-math-symbol={id}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span className="math-symbol-icon" aria-hidden="true">
      ∑
    </span>
  );
}

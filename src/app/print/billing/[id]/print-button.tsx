"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      인쇄 / PDF로 저장
    </button>
  );
}

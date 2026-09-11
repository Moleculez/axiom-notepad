/** Wait for the same local math renderer used by Write/Read before printing. */
export async function printDocument() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  window.dispatchEvent(new Event("axiom:prepare-print"));
  const start = Date.now();
  while (
    Date.now() - start < 20000 &&
    document.querySelector(
      '.reading-view [data-math-request][aria-busy="true"]',
    )
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (
    document.querySelector(
      '.reading-view [data-math-request][aria-busy="true"]',
    )
  )
    throw new Error(
      "Some equations are still rendering. Wait for their previews and try printing again.",
    );
  window.print();
}

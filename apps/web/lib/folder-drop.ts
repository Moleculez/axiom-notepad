/** Snapshot native entries during the drop event; browsers clear the DataTransfer later. */
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.some((entry) => entry.isDirectory))
    return Array.from(transfer.files);
  const files: File[] = [];
  const visit = async (
    entry: FileSystemEntry,
    parent: string,
    depth: number,
  ): Promise<void> => {
    if (depth > 32 || files.length >= 2000)
      throw new Error("Drop up to 2,000 files and 32 folder levels at a time.");
    const path = parent + entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      Object.defineProperty(file, "webkitRelativePath", {
        value: path,
        configurable: true,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const children = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject),
        );
        if (!children.length) break;
        for (const child of children) await visit(child, path + "/", depth + 1);
      }
    }
  };
  for (const entry of entries) await visit(entry, "", 0);
  if (!files.length)
    throw new Error(
      "This folder contains no files. Create an empty folder with New → Folder.",
    );
  return files;
}

import {
  prepareImportInventory,
  type ImportInventoryInput,
} from "./workspace-import-inventory";
self.onmessage = async (event: MessageEvent<ImportInventoryInput>) => {
  try {
    const inventory = await prepareImportInventory(event.data, (label) =>
      self.postMessage({ progress: label }),
    );
    self.postMessage({ inventory });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Import inventory could not be read.",
    });
  }
};

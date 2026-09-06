await page.evaluate(async () => {
  const { qualifySqliteStorage } = await import("/probes/sqlite-storage-browser.js");
  window.sqliteStorageProbe = { phase: "running" };
  void qualifySqliteStorage().then(result => { window.sqliteStorageProbe = result; })
    .catch(error => { window.sqliteStorageProbe = { phase: "failed", error: String(error) }; });
});
return "Real OPFS qualification started; inspect window.sqliteStorageProbe";

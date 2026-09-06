const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const filename = "/runtime-probe/owner.sqlite";
const mode = process.argv[2];
if (mode === "contend") {
  assert.throws(() => new DatabaseSync(filename), /SQLITE_BUSY/);
  console.log("SQLITE_OWNER_BUSY");
} else {
  const db = new DatabaseSync(filename);
  if (mode === "hold") {
    db.exec("DROP TABLE IF EXISTS owner; CREATE TABLE owner(value); INSERT INTO owner VALUES('committed'); BEGIN; UPDATE owner SET value='uncommitted';");
    console.log("SQLITE_OWNER_HELD");
    setInterval(() => {}, 1000);
  } else {
    assert.equal(db.prepare("SELECT value FROM owner").all()[0].value, "committed");
    db.close();
    console.log("SQLITE_OWNER_RELEASED_ROLLBACK");
  }
}

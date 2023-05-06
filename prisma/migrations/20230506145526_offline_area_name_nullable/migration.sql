-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OfflineArea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zoomLevel" INTEGER NOT NULL,
    "boundingBox" TEXT NOT NULL,
    "name" TEXT,
    "styleId" TEXT NOT NULL,
    CONSTRAINT "OfflineArea_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OfflineArea" ("boundingBox", "id", "name", "styleId", "zoomLevel") SELECT "boundingBox", "id", "name", "styleId", "zoomLevel" FROM "OfflineArea";
DROP TABLE "OfflineArea";
ALTER TABLE "new_OfflineArea" RENAME TO "OfflineArea";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

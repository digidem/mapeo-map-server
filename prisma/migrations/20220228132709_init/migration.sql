-- CreateTable
CREATE TABLE "TileData" (
    "tileHash" TEXT NOT NULL,
    "tilesetId" TEXT NOT NULL,
    "data" BLOB NOT NULL,

    PRIMARY KEY ("tileHash", "tilesetId")
);

-- CreateTable
CREATE TABLE "Tile" (
    "etag" TEXT,
    "quadKey" TEXT NOT NULL,
    "tileHash" TEXT NOT NULL,
    "tilesetId" TEXT NOT NULL,

    PRIMARY KEY ("quadKey", "tilesetId"),
    CONSTRAINT "Tile_tileHash_tilesetId_fkey" FOREIGN KEY ("tileHash", "tilesetId") REFERENCES "TileData" ("tileHash", "tilesetId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tile_tilesetId_fkey" FOREIGN KEY ("tilesetId") REFERENCES "Tileset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tileset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tilejson" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "upstreamTileUrls" TEXT,
    "etag" TEXT,
    "upstreamUrl" TEXT
);

-- CreateTable
CREATE TABLE "TilesetsOnStyles" (
    "tilesetId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,

    PRIMARY KEY ("tilesetId", "styleId"),
    CONSTRAINT "TilesetsOnStyles_tilesetId_fkey" FOREIGN KEY ("tilesetId") REFERENCES "Tileset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TilesetsOnStyles_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stylejson" TEXT NOT NULL,
    "etag" TEXT,
    "spriteId" TEXT
);

-- CreateTable
CREATE TABLE "Sprite" (
    "id" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "layout" TEXT NOT NULL,
    "pixelDensity" INTEGER NOT NULL,
    "etag" TEXT,
    "upstreamUrl" TEXT,

    PRIMARY KEY ("id", "pixelDensity")
);

-- CreateTable
CREATE TABLE "Glyph" (
    "fontName" TEXT NOT NULL,
    "rangeId" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "etag" TEXT,
    "upstreamUrl" TEXT,

    PRIMARY KEY ("fontName", "rangeId")
);

-- CreateTable
CREATE TABLE "OfflineArea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zoomLevel" INTEGER NOT NULL,
    "boundingBox" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    CONSTRAINT "OfflineArea_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Download" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "downloadedResources" INTEGER NOT NULL,
    "totalResources" INTEGER NOT NULL,
    "isComplete" BOOLEAN NOT NULL,
    "started" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished" DATETIME,
    "areaId" TEXT NOT NULL,
    CONSTRAINT "Download_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "OfflineArea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Download_areaId_key" ON "Download"("areaId");

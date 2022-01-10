-- See ERD at: https://dbdiagram.io/d/61d7555ef8370f0a2edfd24a

CREATE TABLE IF NOT EXISTS tilesets(
    id STRING NOT NULL PRIMARY KEY,
    -- Description of tileset based on TileJSON spec
    tilejson STRING NOT NULL,
    -- Array of urls pulled from tilejson
    tile_urls STRING NOT NULL,
    etag STRING,
    upstream_url STRING
);

CREATE TABLE IF NOT EXISTS tilesets_styles(
  tileset_id STRING NOT NULL,
  style_id STRING NOT NULL,
  PRIMARY KEY(tileset_id, style_id),
  FOREIGN KEY(tileset_id) REFERENCES tilesets(id),
  FOREIGN KEY(style_id) REFERENCES styles(id)
);

CREATE TABLE IF NOT EXISTS tiles(
    tile_hash STRING NOT NULL PRIMARY KEY,
    data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS tiles_metadata(
    quad_key STRING NOT NULL,
    tileset_id STRING NOT NULL,
    tile_hash STRING NOT NULL,
    etag STRING,
    PRIMARY KEY(quad_key, tileset_id),
    FOREIGN KEY(tileset_id) REFERENCES tilesets(id),
    FOREIGN KEY(tile_hash) REFERENCES tiles(tile_hash)
);

CREATE TABLE IF NOT EXISTS styles(
    id STRING NOT NULL PRIMARY KEY,
    -- JSON string that adheres to style specification v8
    stylejson STRING NOT NULL,
    etag STRING
);

CREATE TABLE IF NOT EXISTS sprites(
    id STRING NOT NULL PRIMARY KEY,
    -- PNG with all images used in a style
    data BLOB NOT NULL,
    -- JSON string describing positions of sprite in data
    layout STRING NOT NULL,
    pixel_density INTEGER NOT NULL,
    etag STRING,
    upstream_url STRING,
    style_id STRING NOT NULL,
    -- TODO: is it desired behavior to update/delete the sprite when the associated style is updated/deleted?
    FOREIGN KEY(style_id) REFERENCES styles(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS glyphs(
    font_name STRING NOT NULL,
    range_id INTEGER NOT NULL,
    data blob NOT NULL,
    etag STRING,
    upstream_url STRING,
    PRIMARY KEY(font_name, range_id)
);

-- TODO: should we add styles_downloaded and tiles_downloaded fields?
CREATE TABLE IF NOT EXISTS downloads(
    id STRING NOT NULL PRIMARY KEY,
    -- TODO: should this only refer to tiles+glyphs?
    downloaded_resources INTEGER NOT NULL,
    -- TODO: should this only refer to tiles+glyphs?
    total_resources INTEGER NOT NULL,
    -- When downloaded = total
    completed BOOLEAN NOT NULL,
    area_id STRING NOT NULL,
    FOREIGN KEY(area_id) REFERENCES offline_areas(id)
);

CREATE TABLE IF NOT EXISTS offline_areas(
    id STRING NOT NULL PRIMARY KEY,
    -- stored as Unix Time (https://www.sqlite.org/datatype3.html)
    timestamp INTEGER NOT NULL,
    -- TODO: add min/max constraint?
    zoom_level INTEGER NOT NULL,
    -- Comma-separated string of 4 floats
    bounding_box STRING NOT NULL,
    -- TODO: is it okay to have a download that is no longer associated with a style? i.e. the style gets deleted
    style_id STRING NOT NULL,
    FOREIGN KEY(style_id) REFERENCES styles(id)
);
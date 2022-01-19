import { RasterStyleJSON } from "./lib/styles"

export function createRasterStyleJSON(tilesetName:string, tilesetId:string, tileUrls:string[]):RasterStyleJSON
{
    let idObject: {[k:string]:{type:"raster", tiles:string[], tileSize:256}} = {}
    idObject[tilesetId] = 
    {
        type:"raster", 
        tiles:tileUrls, 
        tileSize:256
    }
    return {
        version:1,
        name:tilesetName,
        sources:idObject,
        layers:[{
            id: Math.floor(Math.random() * (1000 - 10000) + 1000) + tilesetId,
            type:"raster",
            source:tilesetId
        }]
    }
}
export function createRasterStyleJSON(tilesetName:string, tilesetId:string, tiles:string[], layerIds:string[])
{
    let idObject: {[k:string]:Object} = {}
    idObject[tilesetId] = {type:"raster", tiles:tiles, tileSize:256}
    return JSON.stringify({
        version:1,
        name:tilesetName,
        sources:idObject,
        layer:layerIds.map(layer=>({id:layer, type:'raster', source:tilesetId}))
    })
}
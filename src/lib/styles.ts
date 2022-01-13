import { Static, Type as T } from '@sinclair/typebox'

const RasterStyleSchema = T.Object(
{
    version:T.Number(),
    name:T.String(),
    sources:T.Object(
    {
        
        //Need to fix this typing
        tilesetId: T.Object(
        {
            type:T.Literal('raster'),
            tiles:T.Array(T.String({ format: 'uri' })),
            tileSize:T.Literal(256)
        })
    }),
    layers:T.Array(T.Object({
        id:T.String(),
        type:T.Literal('raster'),
        source:T.String()
    }))
})


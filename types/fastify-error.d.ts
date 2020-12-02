// Fix for incorrect type pending https://github.com/fastify/fastify-error/pull/6
declare module 'fastify-error' {
  export interface FastifyError extends Error {
    code: string
    statusCode?: number
    validation?: ValidationResult[]
  }

  export interface FastifyErrorConstructor extends ErrorConstructor {
    new (a?: any, b?: any, c?: any): FastifyError
    (a?: any, b?: any, c?: any): FastifyError
    readonly prototype: FastifyError
  }

  export interface ValidationResult {
    keyword: string
    dataPath: string
    schemaPath: string
    params: Record<string, string | string[]>
    message: string
  }

  function createError(
    code: string,
    message: string,
    statusCode?: number,
    Base?: Error
  ): FastifyErrorConstructor

  export default createError
}

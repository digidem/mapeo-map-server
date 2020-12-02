declare module 'mutexify/promise' {
  export type Lock = Promise<() => void>
  function Mutexify(): () => Lock
  export default Mutexify
}

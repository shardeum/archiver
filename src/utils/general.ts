export const XOR = (hexString1, hexString2): number => {
  // tslint:disable-next-line: ban
  const num1 = parseInt(hexString1.substring(0, 8), 16)
  // tslint:disable-next-line: ban
  const num2 = parseInt(hexString2.substring(0, 8), 16)
  return (num1 ^ num2) >>> 0
}
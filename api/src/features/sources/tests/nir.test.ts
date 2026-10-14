import { canonicalNir, nirKeyIsValid } from '../nir'

// Fictitious numbers only (no real NIR in the repository); the right keys are checked by hand: 97 − (N mod 97).
describe('check key of the NIR', () => {
  it('[rule-evp-nir-key-vectors] the vectors of the request: 46 is right for 1 84 12 76 451 089, 47 is wrong', () => {
    expect(nirKeyIsValid('184127645108946')).toBe(true)
    expect(nirKeyIsValid('184127645108947')).toBe(false)
  })

  it('[rule-evp-nir-key-formula] Corsica: 2A counts for 19 and 2B for 18, so the key of 2B is wrong for 2A', () => {
    expect(nirKeyIsValid('185032A00401238')).toBe(true)
    expect(nirKeyIsValid('185032B00401265')).toBe(true)
    expect(nirKeyIsValid('185032A00401265')).toBe(false)
  })

  it('[rule-evp-nir-key-formula] a remainder of 0 gives the key 97', () => {
    expect(nirKeyIsValid('291031234562697')).toBe(true)
  })

  it('[rule-evp-nir-key-vectors] the key 00 is always wrong', () => {
    expect(nirKeyIsValid('285057512345600')).toBe(false)
  })

  it('[rule-evp-nir-key-formula] separators and case are ignored; a number that is not a complete NIR is not valid', () => {
    expect(nirKeyIsValid('1 84 12 76 451 089 46')).toBe(true)
    expect(nirKeyIsValid('1.84.12.76.451.089-46')).toBe(true)
    expect(nirKeyIsValid('1 85 03 2a 004 012 38')).toBe(true)
    expect(nirKeyIsValid('1841276451089')).toBe(false)
    expect(nirKeyIsValid(null)).toBe(false)
    expect(nirKeyIsValid('abc')).toBe(false)
  })

  it('[rule-evp-nir-key-formula] the key is computed on the 13 digits without loss of precision (BigInt), not on the 15', () => {
    const head = '2999999999999'
    const key = String(97n - (BigInt(head) % 97n)).padStart(2, '0')
    const wrong = String((Number(key) % 97) + 1).padStart(2, '0')
    expect(nirKeyIsValid(`${head}${key}`)).toBe(true)
    expect(nirKeyIsValid(`${head}${wrong}`)).toBe(false)
    expect(canonicalNir(`${head}${key}`)).toBe(`${head}${key}`)
  })
})

// AES-256-GCM encryption for tokens
const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const TAG_LENGTH = 128

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getKey(encryptionKey: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(encryptionKey)
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encrypt(
  plaintext: string,
  encryptionKey: string
): Promise<string> {
  const key = await getKey(encryptionKey)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoded
  )

  // Format: IV (hex) + ':' + ciphertext (hex)
  return bytesToHex(iv) + ':' + bytesToHex(new Uint8Array(ciphertext))
}

export async function decrypt(
  encrypted: string,
  encryptionKey: string
): Promise<string> {
  const [ivHex, ciphertextHex] = encrypted.split(':')
  const iv = hexToBytes(ivHex)
  const ciphertext = hexToBytes(ciphertextHex)

  const key = await getKey(encryptionKey)

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    ciphertext
  )

  return new TextDecoder().decode(decrypted)
}

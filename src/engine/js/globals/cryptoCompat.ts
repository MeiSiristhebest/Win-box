import * as CryptoES from 'crypto-es';

/**
 * Keep the CryptoJS surface used by community spider scripts while backing it
 * with crypto-es. New application code should import the specific crypto-es
 * API it needs instead of depending on this compatibility object.
 */
export const CryptoJS = {
  ...CryptoES,
  enc: {
    Hex: CryptoES.Hex,
    Latin1: CryptoES.Latin1,
    Utf8: CryptoES.Utf8,
    Utf16: CryptoES.Utf16,
    Utf16BE: CryptoES.Utf16BE,
    Utf16LE: CryptoES.Utf16LE,
    Base64: CryptoES.Base64,
    Base64url: CryptoES.Base64url,
  },
  mode: {
    CBC: CryptoES.CBC,
    CFB: CryptoES.CFB,
    CTR: CryptoES.CTR,
    CTRGladman: CryptoES.CTRGladman,
    ECB: CryptoES.ECB,
    OFB: CryptoES.OFB,
  },
  pad: {
    Pkcs7: CryptoES.Pkcs7,
    AnsiX923: CryptoES.AnsiX923,
    Iso10126: CryptoES.Iso10126,
    Iso97971: CryptoES.Iso97971,
    NoPadding: CryptoES.NoPadding,
    ZeroPadding: CryptoES.ZeroPadding,
  },
  algo: {
    MD5: CryptoES.MD5Algo,
    SHA1: CryptoES.SHA1Algo,
    SHA224: CryptoES.SHA224Algo,
    SHA256: CryptoES.SHA256Algo,
    SHA384: CryptoES.SHA384Algo,
    SHA512: CryptoES.SHA512Algo,
    SHA3: CryptoES.SHA3Algo,
    RIPEMD160: CryptoES.RIPEMD160Algo,
    PBKDF2: CryptoES.PBKDF2Algo,
    EvpKDF: CryptoES.EvpKDFAlgo,
    AES: CryptoES.AESAlgo,
    DES: CryptoES.DESAlgo,
    TripleDES: CryptoES.TripleDESAlgo,
    Rabbit: CryptoES.RabbitAlgo,
    RabbitLegacy: CryptoES.RabbitLegacyAlgo,
    RC4: CryptoES.RC4Algo,
    RC4Drop: CryptoES.RC4DropAlgo,
    Blowfish: CryptoES.BlowfishAlgo,
  },
  lib: {
    Base: CryptoES.Base,
    WordArray: CryptoES.WordArray,
    BufferedBlockAlgorithm: CryptoES.BufferedBlockAlgorithm,
    Hasher: CryptoES.Hasher,
    HMAC: CryptoES.HMAC,
    Cipher: CryptoES.Cipher,
    StreamCipher: CryptoES.StreamCipher,
    BlockCipherMode: CryptoES.BlockCipherMode,
    BlockCipher: CryptoES.BlockCipher,
    CipherParams: CryptoES.CipherParams,
    SerializableCipher: CryptoES.SerializableCipher,
    PasswordBasedCipher: CryptoES.PasswordBasedCipher,
  },
  format: {
    OpenSSL: CryptoES.OpenSSLFormatter,
    Hex: CryptoES.HexFormatter,
  },
  kdf: {
    OpenSSL: CryptoES.OpenSSLKdf,
  },
  x64: {
    Word: CryptoES.X64Word,
    WordArray: CryptoES.X64WordArray,
  },
};

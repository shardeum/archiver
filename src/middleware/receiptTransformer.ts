import { Database } from 'sqlite3'
import { promisify } from 'util'
import { SignedReceipt, ArchiverReceipt } from '../dbstore/receipts'
import { receiptDatabase } from '../dbstore'
import * as Logger from '../Logger'
import { config } from '../Config'

interface NodeMapping {
  nodeId: number
  publicKey: string
}

interface CompressedSignature {
  id: number
  sig: string
}

interface OriginalSignature {
  owner: string
  sig: string
}

// In-memory cache for node mappings (LRU-style)
class NodeCache {
  private cache: Map<string, number> = new Map()
  private reverseCache: Map<number, string> = new Map()
  private maxSize: number = 10000

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  set(publicKey: string, nodeId: number): void {
    // Remove oldest entry if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(publicKey)) {
      const firstKey = this.cache.keys().next().value
      const firstId = this.cache.get(firstKey)
      this.cache.delete(firstKey)
      if (firstId) this.reverseCache.delete(firstId)
    }

    this.cache.set(publicKey, nodeId)
    this.reverseCache.set(nodeId, publicKey)
  }

  getNodeId(publicKey: string): number | undefined {
    const nodeId = this.cache.get(publicKey)
    if (nodeId !== undefined) {
      // Move to end (LRU behavior)
      this.cache.delete(publicKey)
      this.cache.set(publicKey, nodeId)
    }
    return nodeId
  }

  getPublicKey(nodeId: number): string | undefined {
    return this.reverseCache.get(nodeId)
  }

  clear(): void {
    this.cache.clear()
    this.reverseCache.clear()
  }
}

// Global node cache instance
const nodeCache = new NodeCache()

// Promisified database operations
// The sqlite3 methods already have callback as the last parameter, so we can bind directly
const dbGet = (db: Database, sql: string, params: any[]) => {
  return new Promise<any>((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err)
      else resolve(row)
    })
  })
}

const dbRun = (db: Database, sql: string, params: any[]) => {
  return new Promise<void>((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err)
      else resolve()
    })
  })
}

const dbAll = (db: Database, sql: string, params: any[]) => {
  return new Promise<any[]>((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

/**
 * Get or create node ID for a public key
 */
async function getOrCreateNodeId(publicKey: string): Promise<number> {
  // Check cache first
  const cachedId = nodeCache.getNodeId(publicKey)
  if (cachedId !== undefined) {
    return cachedId
  }

  try {
    // Check database
    const row = await dbGet(receiptDatabase, 'SELECT node_id FROM nodes WHERE public_key = ?', [publicKey])
    
    if (row) {
      nodeCache.set(publicKey, row.node_id)
      return row.node_id
    }

    // Insert new node
    const firstSeen = Date.now()
    await dbRun(receiptDatabase, 'INSERT INTO nodes (public_key, first_seen) VALUES (?, ?)', [publicKey, firstSeen])
    
    // Get the inserted ID
    const newRow = await dbGet(receiptDatabase, 'SELECT node_id FROM nodes WHERE public_key = ?', [publicKey])
    if (newRow) {
      nodeCache.set(publicKey, newRow.node_id)
      return newRow.node_id
    }

    throw new Error('Failed to create node mapping')
  } catch (error) {
    Logger.mainLogger.error('Error in getOrCreateNodeId:', error)
    throw error
  }
}

/**
 * Get public key for a node ID
 */
async function getPublicKeyForNodeId(nodeId: number): Promise<string | null> {
  // Check cache first
  const cachedKey = nodeCache.getPublicKey(nodeId)
  if (cachedKey !== undefined) {
    return cachedKey
  }

  try {
    const row = await dbGet(receiptDatabase, 'SELECT public_key FROM nodes WHERE node_id = ?', [nodeId])
    
    if (row) {
      nodeCache.set(row.public_key, nodeId)
      return row.public_key
    }

    return null
  } catch (error) {
    Logger.mainLogger.error('Error in getPublicKeyForNodeId:', error)
    return null
  }
}

/**
 * Batch get or create node IDs for multiple public keys
 */
async function batchGetOrCreateNodeIds(publicKeys: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const uncachedKeys: string[] = []

  // Check cache first
  for (const publicKey of publicKeys) {
    const cachedId = nodeCache.getNodeId(publicKey)
    if (cachedId !== undefined) {
      result.set(publicKey, cachedId)
    } else {
      uncachedKeys.push(publicKey)
    }
  }

  if (uncachedKeys.length === 0) {
    return result
  }

  try {
    // Batch query database
    if (uncachedKeys.length === 0) {
      return result
    }
    const placeholders = uncachedKeys.map(() => '?').join(',')
    const rows = await dbAll(
      receiptDatabase, 
      `SELECT node_id, public_key FROM nodes WHERE public_key IN (${placeholders})`,
      uncachedKeys
    )

    // Process existing nodes
    const existingKeys = new Set<string>()
    for (const row of rows) {
      result.set(row.public_key, row.node_id)
      nodeCache.set(row.public_key, row.node_id)
      existingKeys.add(row.public_key)
    }

    // Insert new nodes
    const newKeys = uncachedKeys.filter(key => !existingKeys.has(key))
    if (newKeys.length > 0) {
      const firstSeen = Date.now()
      const insertPlaceholders = newKeys.map(() => '(?, ?)').join(',')
      const insertParams = newKeys.flatMap(key => [key, firstSeen])
      await dbRun(receiptDatabase, `INSERT INTO nodes (public_key, first_seen) VALUES ${insertPlaceholders}`, insertParams)

      // Query newly inserted nodes
      const newPlaceholders = newKeys.map(() => '?').join(',')
      const newRows = await dbAll(
        receiptDatabase,
        `SELECT node_id, public_key FROM nodes WHERE public_key IN (${newPlaceholders})`,
        newKeys
      )

      for (const row of newRows) {
        result.set(row.public_key, row.node_id)
        nodeCache.set(row.public_key, row.node_id)
      }
    }

    return result
  } catch (error) {
    Logger.mainLogger.error('Error in batchGetOrCreateNodeIds:', error)
    throw error
  }
}

/**
 * Compress signatures in a receipt by replacing public keys with node IDs
 */
export async function compressReceiptSignatures(receipt: ArchiverReceipt): Promise<ArchiverReceipt> {
  if (!config.receiptSignatureOptimization?.enabled) {
    return receipt
  }

  try {
    const signedReceipt = receipt.signedReceipt as SignedReceipt
    
    // Skip if already compressed or no signature pack
    if (!signedReceipt.signaturePack || signedReceipt.signaturePack.length === 0) {
      return receipt
    }

    // Check if already compressed
    if ((signedReceipt as any)._compressed === true) {
      return receipt
    }

    // Extract all public keys
    const publicKeys = signedReceipt.signaturePack.map(sig => sig.owner)
    
    // Batch get/create node IDs
    const nodeIdMap = await batchGetOrCreateNodeIds(publicKeys)

    // Create compressed signature pack
    const compressedSignatures: CompressedSignature[] = signedReceipt.signaturePack.map(sig => ({
      id: nodeIdMap.get(sig.owner) || 0,
      sig: sig.sig
    }))

    // Create compressed receipt
    const compressedReceipt = {
      ...receipt,
      signedReceipt: {
        ...signedReceipt,
        signaturePack: compressedSignatures as any,
        _compressed: true
      }
    }

    return compressedReceipt
  } catch (error) {
    Logger.mainLogger.error('Error compressing receipt signatures:', error)
    // Return original receipt on error
    return receipt
  }
}

/**
 * Decompress signatures in a receipt by replacing node IDs with public keys
 */
export async function decompressReceiptSignatures(receipt: ArchiverReceipt): Promise<ArchiverReceipt> {
  if (!config.receiptSignatureOptimization?.enabled) {
    return receipt
  }

  try {
    const signedReceipt = receipt.signedReceipt as any

    // Skip if not compressed or no signature pack
    if (!signedReceipt._compressed || !signedReceipt.signaturePack || signedReceipt.signaturePack.length === 0) {
      return receipt
    }

    // Batch get public keys for all node IDs
    const nodeIds = signedReceipt.signaturePack.map((sig: CompressedSignature) => sig.id)
    const uniqueNodeIds = [...new Set(nodeIds)]
    
    // Batch query
    if (uniqueNodeIds.length === 0) {
      return receipt
    }
    const placeholders = uniqueNodeIds.map(() => '?').join(',')
    const rows = await dbAll(
      receiptDatabase,
      `SELECT node_id, public_key FROM nodes WHERE node_id IN (${placeholders})`,
      uniqueNodeIds
    )

    // Create lookup map
    const nodeIdToPublicKey = new Map<number, string>()
    for (const row of rows) {
      nodeIdToPublicKey.set(row.node_id, row.public_key)
      nodeCache.set(row.public_key, row.node_id)
    }

    // Create decompressed signature pack
    const decompressedSignatures: OriginalSignature[] = signedReceipt.signaturePack.map((sig: CompressedSignature) => ({
      owner: nodeIdToPublicKey.get(sig.id) || '',
      sig: sig.sig
    }))

    // Remove _compressed flag and restore original structure
    const { _compressed, ...cleanSignedReceipt } = signedReceipt
    
    const decompressedReceipt = {
      ...receipt,
      signedReceipt: {
        ...cleanSignedReceipt,
        signaturePack: decompressedSignatures
      }
    }

    return decompressedReceipt
  } catch (error) {
    Logger.mainLogger.error('Error decompressing receipt signatures:', error)
    // Return original receipt on error
    return receipt
  }
}

/**
 * Preload active nodes into cache for better performance
 */
export async function preloadNodeCache(): Promise<void> {
  if (!config.receiptSignatureOptimization?.enabled) {
    return
  }

  try {
    // Load most recent nodes (adjust limit based on network size)
    const rows = await dbAll(
      receiptDatabase,
      'SELECT node_id, public_key FROM nodes ORDER BY first_seen DESC LIMIT ?',
      [10000]
    )

    nodeCache.clear()
    for (const row of rows) {
      nodeCache.set(row.public_key, row.node_id)
    }

    Logger.mainLogger.info(`Preloaded ${rows.length} nodes into cache`)
  } catch (error) {
    Logger.mainLogger.error('Error preloading node cache:', error)
  }
}

/**
 * Clear the node cache
 */
export function clearNodeCache(): void {
  nodeCache.clear()
}
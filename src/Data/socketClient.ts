import * as ioclient from 'socket.io-client'
import { Socket as SocketIOSocket } from 'socket.io-client'
import * as NodeList from '../NodeList'
import * as Logger from '../Logger'
import * as Crypto from '../Crypto'
import * as State from '../State'
import * as Utils from '../Utils'
import * as UtilsTypes from '@shardus/types'
import * as StringUtils from '@shardus/types/build/src/utils/StringifyReduce'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import { config } from '../Config'
import * as P2PTypes from '@shardus/types'
import { DataResponse, DataSender, DataRequestTypes, subscriptionCycleData } from './types'
import { collectCycleData } from './cycleData'
import { storeReceiptData, storeOriginalTxData, storeAccountData } from './dataSync'
import { getCurrentCycleCounter } from '../Cycles'
import * as Cycles from '../Cycles'

const GENESIS_ACCOUNTS_CYCLE_RANGE = {
  startCycle: 0,
  endCycle: 5,
}
import { sendDataRequest } from './dataRequests'
import { 
  clearCombinedAccountsData, 
  addToCombinedAccountsData, 
  getCombinedAccountsData,
  syncGenesisAccountsFromConsensor 
} from './accountData'

export const socketClients: Map<NodeList.ConsensusNodeInfo['publicKey'], SocketIOSocket> = new Map()

export let forwardGenesisAccounts = false
export let storingAccountData = false

export function setForwardGenesisAccounts(value: boolean): void {
  forwardGenesisAccounts = value
}

export function setStoringAccountData(value: boolean): void {
  storingAccountData = value
}

export class ValidationTracker {
  public discrepancyList: P2PTypes.CycleCreatorTypes.CycleData[]
  constructor() {
    this.discrepancyList = []
  }
  add(data): void {
    this.discrepancyList.push(data)
  }
}

export const validationTracker = new ValidationTracker()

export function unsubscribeDataSender(
  publicKey: NodeList.ConsensusNodeInfo['publicKey'],
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): void {
  const sender = dataSenders.get(publicKey)
  if (sender) {
    if (sender.contactTimeout) {
      clearTimeout(sender.contactTimeout)
      sender.contactTimeout = null
    }
    sendDataRequest(sender.nodeInfo, DataRequestTypes.UNSUBSCRIBE)
    dataSenders.delete(publicKey)
  }
  const socketClient = socketClients.get(publicKey)
  if (socketClient) {
    socketClient.emit('UNSUBSCRIBE', config.ARCHIVER_PUBLIC_KEY)
    socketClient.close()
    socketClients.delete(publicKey)
  }
  nestedCountersInstance.countEvent('archiver', 'remove_data_sender')
  Logger.mainLogger.debug('Subscribed dataSenders', dataSenders.size, 'Connected socketClients', socketClients.size)
  if (config.VERBOSE)
    Logger.mainLogger.debug(
      'Subscribed dataSenders',
      dataSenders.keys(),
      'Connected socketClients',
      socketClients.keys()
    )
}

export function initSocketClient(
  node: NodeList.ConsensusNodeInfo,
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>,
  createContactTimeout: (publicKey: string, msg: string) => NodeJS.Timeout
): void {
  if (config.VERBOSE) Logger.mainLogger.debug('Node Info to socket connect', node)

  try {
    const socketClient = ioclient.connect(`http://${node.ip}:${node.port}`, {
      query: {
        data: StringUtils.safeStringify(
          Crypto.sign({
            publicKey: State.getNodeInfo().publicKey,
            timestamp: Date.now(),
            intendedConsensor: node.publicKey,
          })
        ),
      },
    })
    socketClients.set(node.publicKey, socketClient)

    socketClient.on('connect', () => {
      Logger.mainLogger.debug(`✅ New Socket Connection to consensus node ${node.ip}:${node.port} is made`)
      if (config.VERBOSE) Logger.mainLogger.debug('Connected node', node)
      if (config.VERBOSE) Logger.mainLogger.debug('Init socketClients', socketClients.size, dataSenders.size)
    })

    socketClient.once('disconnect', async () => {
      Logger.mainLogger.debug(`Connection request is refused by the consensor node ${node.ip}:${node.port}`)
    })

    socketClient.on('DATA', (data: string) => {
      const newData: DataResponse<P2PTypes.SnapshotTypes.ValidTypes> & Crypto.TaggedMessage =
        StringUtils.safeJsonParse(data)
      if (!newData || !newData.responses) return
      if (newData.recipient !== State.getNodeInfo().publicKey) {
        Logger.mainLogger.debug('This data is not meant for this archiver')
        return
      }

      if (Crypto.authenticate(newData) === false) {
        Logger.mainLogger.debug('This data cannot be authenticated')
        unsubscribeDataSender(node.publicKey, dataSenders)
        return
      }

      if (config.experimentalSnapshot) {
        let sender = dataSenders.get(newData.publicKey)
        if (!sender) {
          Logger.mainLogger.error('This sender is not in the subscribed nodes list', newData.publicKey)
          return
        }
        if (sender.contactTimeout) {
          if (config.VERBOSE) Logger.mainLogger.debug('Clearing contact timeout.')
          clearTimeout(sender.contactTimeout)
          sender.contactTimeout = null
          nestedCountersInstance.countEvent('archiver', 'clear_contact_timeout')
        }

        if (config.VERBOSE) console.log('DATA', sender.nodeInfo.publicKey, sender.nodeInfo.ip, sender.nodeInfo.port)

        if (newData.responses && newData.responses.ORIGINAL_TX_DATA) {
          if (config.VERBOSE)
            Logger.mainLogger.debug(
              'ORIGINAL_TX_DATA',
              sender.nodeInfo.publicKey,
              sender.nodeInfo.ip,
              sender.nodeInfo.port,
              newData.responses.ORIGINAL_TX_DATA.length
            )
        }
        if (newData.responses && newData.responses.RECEIPT) {
          if (config.VERBOSE)
            Logger.mainLogger.debug(
              'RECEIPT',
              sender.nodeInfo.publicKey,
              sender.nodeInfo.ip,
              sender.nodeInfo.port,
              newData.responses.RECEIPT.length
            )
          storeReceiptData(
            newData.responses.RECEIPT,
            sender.nodeInfo.ip + ':' + sender.nodeInfo.port,
            true,
            config.saveOnlyGossipData,
            true
          )
        }
        if (newData.responses && newData.responses.CYCLE) {
          collectCycleData(newData.responses.CYCLE, sender.nodeInfo.ip + ':' + sender.nodeInfo.port, 'data-sender', dataSenders)
        }
        if (newData.responses && newData.responses.ACCOUNT) {
          if (getCurrentCycleCounter() > GENESIS_ACCOUNTS_CYCLE_RANGE.endCycle) {
            Logger.mainLogger.error(
              'Account data is not meant to be received after the genesis accounts cycle range',
              getCurrentCycleCounter()
            )
            unsubscribeDataSender(sender.nodeInfo.publicKey, dataSenders)
            return
          }
          if (
            Cycles.currentNetworkMode !== 'forming' ||
            NodeList.byPublicKey.size > 1 ||
            !NodeList.byPublicKey.has(sender.nodeInfo.publicKey)
          ) {
            Logger.mainLogger.error(
              'Account data is not meant to be received by the first validator',
              `Number of nodes in the network ${NodeList.byPublicKey.size}`
            )
            unsubscribeDataSender(sender.nodeInfo.publicKey, dataSenders)
            return
          }
          Logger.mainLogger.debug(`RECEIVED ACCOUNTS DATA FROM ${sender.nodeInfo.ip}:${sender.nodeInfo.port}`)
          nestedCountersInstance.countEvent('genesis', 'accounts', 1)
          if (!forwardGenesisAccounts) {
            Logger.mainLogger.debug('Genesis Accounts To Sync', newData.responses.ACCOUNT)
            syncGenesisAccountsFromConsensor(newData.responses.ACCOUNT, sender.nodeInfo)
          } else {
            if (storingAccountData) {
              Logger.mainLogger.debug('Storing Account Data')
              if (newData.responses.ACCOUNT.accounts || newData.responses.ACCOUNT.receipts) {
                addToCombinedAccountsData(newData.responses.ACCOUNT)
              }
            } else storeAccountData(newData.responses.ACCOUNT)
          }
        }

        nestedCountersInstance.countEvent('archiver', 'postpone_contact_timeout')
        sender = dataSenders.get(newData.publicKey)
        if (sender)
          sender.contactTimeout = createContactTimeout(
            sender.nodeInfo.publicKey,
            'This timeout is created after processing data'
          )
      }
    })
  } catch (error) {
    console.error('Error occurred during socket connection:', error)
  }
}
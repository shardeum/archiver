import * as NodeList from '../NodeList'
import * as Logger from '../Logger'
import { config } from '../Config'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import { DataSender } from './types'
import { sendDataRequest } from './dataRequests'
import { DataRequestTypes } from './types'
import { initSocketClient, unsubscribeDataSender } from './socketClient'
import { getConsensusRadius, getCurrentConsensusRadius, setCurrentConsensusRadius } from './networkConfig'
import * as P2PTypes from '@shardus/types'
import * as StateMetaData from '../archivedCycle/StateMetaData'

let subsetNodesMapByConsensusRadius: Map<number, NodeList.ConsensusNodeInfo[]> = new Map()

export function createContactTimeout(publicKey: NodeList.ConsensusNodeInfo['publicKey'], msg = ''): NodeJS.Timeout {
  const CONTACT_TIMEOUT_MS = 10 * 1000
  if (config.VERBOSE) Logger.mainLogger.debug('Created contact timeout: ' + CONTACT_TIMEOUT_MS, `for ${publicKey}`)
  nestedCountersInstance.countEvent('archiver', 'contact_timeout_created')
  return setTimeout(() => {
    if (nestedCountersInstance) nestedCountersInstance.countEvent('archiver', 'contact_timeout')
    Logger.mainLogger.debug('REPLACING sender due to CONTACT timeout', msg, publicKey)
    replaceDataSender(publicKey)
  }, CONTACT_TIMEOUT_MS)
}

export function addDataSender(sender: DataSender, dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>): void {
  dataSenders.set(sender.nodeInfo.publicKey, sender)
}

export async function replaceDataSender(
  publicKey: NodeList.ConsensusNodeInfo['publicKey'],
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): Promise<void> {
  nestedCountersInstance.countEvent('archiver', 'replace_data_sender')
  if (NodeList.getActiveNodeCount() < 2) {
    Logger.mainLogger.debug('There is only one active node in the network. Unable to replace data sender')
    return
  }
  Logger.mainLogger.debug(`replaceDataSender: replacing ${publicKey}`)

  if (!socketClients.has(publicKey) || !dataSenders.has(publicKey)) {
    Logger.mainLogger.debug(
      'This data sender is not in the subscribed list! and unsubscribing it',
      publicKey,
      socketClients.has(publicKey),
      dataSenders.has(publicKey)
    )
    unsubscribeDataSender(publicKey, dataSenders)
    return
  }
  unsubscribeDataSender(publicKey, dataSenders)
  const node = NodeList.byPublicKey.get(publicKey)
  if (node) {
    const nodeIndex = NodeList.activeListByIdSorted.findIndex((node) => node.publicKey === publicKey)
    if (nodeIndex > -1) {
      const subsetIndex = Math.floor(nodeIndex / getCurrentConsensusRadius())
      const subsetNodesList = subsetNodesMapByConsensusRadius.get(subsetIndex)
      if (!subsetNodesList) {
        Logger.mainLogger.error(`There is no nodes in the index ${subsetIndex} of subsetNodesMapByConsensusRadius!`)
        return
      }
      subscribeNodeFromThisSubset(subsetNodesList, subsetIndex, dataSenders)
    }
  }
}

export async function subscribeNodeForDataTransfer(
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): Promise<void> {
  if(config.passiveMode) {
    Logger.mainLogger.debug('Archiver is in passive mode. Skipping data transfer subscription.')
    return
  }

  if (config.experimentalSnapshot) {
    await subscribeConsensorsByConsensusRadius(dataSenders)
  } else {
    await StateMetaData.subscribeRandomNodeForDataTransfer()
  }
}

export async function createDataTransferConnection(
  newSenderInfo: NodeList.ConsensusNodeInfo,
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): Promise<boolean> {
  const response = await sendDataRequest(newSenderInfo, DataRequestTypes.SUBSCRIBE)
  if (response) {
    initSocketClient(newSenderInfo, dataSenders, createContactTimeout)
    const newSender: DataSender = {
      nodeInfo: newSenderInfo,
      types: [P2PTypes.SnapshotTypes.TypeNames.CYCLE, P2PTypes.SnapshotTypes.TypeNames.STATE_METADATA],
      contactTimeout: createContactTimeout(
        newSenderInfo.publicKey,
        'This timeout is created during newSender selection'
      ),
    }
    addDataSender(newSender, dataSenders)
    Logger.mainLogger.debug(`added new sender ${newSenderInfo.publicKey} to dataSenders`)
  }
  return response
}

function shouldSubscribeToMoreConsensors(): boolean {
  return config.subscribeToMoreConsensors && getCurrentConsensusRadius() > 5
}

export async function createNodesGroupByConsensusRadius(): Promise<void> {
  const consensusRadius = await getConsensusRadius()
  if (consensusRadius === 0) {
    Logger.mainLogger.error('Consensus radius is 0, unable to create nodes group.')
    return
  }
  setCurrentConsensusRadius(consensusRadius)
  const activeList = [...NodeList.activeListByIdSorted]
  if (config.VERBOSE) Logger.mainLogger.debug('activeList', activeList.length, activeList)
  let totalNumberOfNodesToSubscribe = Math.ceil(activeList.length / consensusRadius)
  if (shouldSubscribeToMoreConsensors()) {
    totalNumberOfNodesToSubscribe += totalNumberOfNodesToSubscribe * config.extraConsensorsToSubscribe
  }
  Logger.mainLogger.debug('totalNumberOfNodesToSubscribe', totalNumberOfNodesToSubscribe)
  subsetNodesMapByConsensusRadius = new Map()
  let round = 0
  for (let i = 0; i < activeList.length; i += consensusRadius) {
    const subsetList: NodeList.ConsensusNodeInfo[] = activeList.slice(i, i + consensusRadius)
    subsetNodesMapByConsensusRadius.set(round, subsetList)
    round++
  }
  if (config.VERBOSE) Logger.mainLogger.debug('subsetNodesMapByConsensusRadius', subsetNodesMapByConsensusRadius)
}

export async function subscribeConsensorsByConsensusRadius(
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): Promise<void> {
  await createNodesGroupByConsensusRadius()
  for (const [i, subsetList] of subsetNodesMapByConsensusRadius) {
    if (config.VERBOSE) Logger.mainLogger.debug('Round', i, 'subsetList', subsetList, dataSenders.keys())
    subscribeNodeFromThisSubset(subsetList, i, dataSenders)
  }
}

export async function subscribeNodeFromThisSubset(
  nodeList: NodeList.ConsensusNodeInfo[],
  roundIndex: number,
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): Promise<void> {
  const subscribedNodesFromThisSubset = []
  for (const node of nodeList) {
    if (dataSenders.has(node.publicKey)) {
      if (config.VERBOSE)
        Logger.mainLogger.debug('This node from the subset is in the subscribed list!', node.publicKey)
      subscribedNodesFromThisSubset.push(node.publicKey)
    }
  }
  let numberOfNodesToSubsribe = 1
  if (shouldSubscribeToMoreConsensors()) {
    numberOfNodesToSubsribe += config.extraConsensorsToSubscribe
    nestedCountersInstance.countEvent(
      'nodeSubscription',
      'add extra consensor(s): ' + config.extraConsensorsToSubscribe
    )
  } else {
    nestedCountersInstance.countEvent('nodeSubscription', 'add consensor: ')
  }
  if (subscribedNodesFromThisSubset.length > numberOfNodesToSubsribe) {
    for (const publicKey of subscribedNodesFromThisSubset.splice(numberOfNodesToSubsribe)) {
      Logger.mainLogger.debug('Unsubscribing extra node from this subset', publicKey)
      unsubscribeDataSender(publicKey, dataSenders)
    }
  }
  if (config.VERBOSE) Logger.mainLogger.debug('Subscribed nodes from this subset', subscribedNodesFromThisSubset)
  if (subscribedNodesFromThisSubset.length === numberOfNodesToSubsribe) return
  Logger.mainLogger.debug(
    `Subscribing node(s) from this subset! numberOfNodesToSubsribe: ${numberOfNodesToSubsribe} roundIndex: ${roundIndex}`
  )
  let subsetList = [...nodeList]
  let newSenderInfo = nodeList[Math.floor(Math.random() * nodeList.length)]
  let connectionStatus = false
  let retry = 0
  const MAX_RETRY_SUBSCRIPTION = 3 * numberOfNodesToSubsribe
  while (retry < MAX_RETRY_SUBSCRIPTION && subscribedNodesFromThisSubset.length < numberOfNodesToSubsribe) {
    if (!dataSenders.has(newSenderInfo.publicKey)) {
      connectionStatus = await createDataTransferConnection(newSenderInfo, dataSenders)
      if (connectionStatus) {
        if (!subscribedNodesFromThisSubset.includes(newSenderInfo.publicKey)) {
          subscribedNodesFromThisSubset.push(newSenderInfo.publicKey)
          Logger.mainLogger.debug(
            `Added new sender to the subscribed nodes of this subset. publicKey:${newSenderInfo.publicKey}, numberOfNodesToSubsribe:${numberOfNodesToSubsribe}, roundIndex${roundIndex}`
          )
        }
      }
    }
    retry++
    subsetList = subsetList.filter((node) => node.publicKey !== newSenderInfo.publicKey)
    if (subsetList.length === 0) {
      Logger.mainLogger.debug(`Unable to find a new sender from this subset! round: ${roundIndex}`)
      break
    }
    newSenderInfo = subsetList[Math.floor(Math.random() * subsetList.length)]
  }
}

// Import socketClients from socketClient
import { socketClients } from './socketClient'

// Export functions that Data.ts needs
export { replaceDataSender as replaceDataSenderMain }
import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-contract-sizer';
import { JsonRpcProvider } from "ethers"

import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '/.env') });

import fs from 'fs';
import { uniquePairs } from './ignition/modules/multipleDeploy';

task("buildDeployedAddressesByDescription").addParam('chainId', 'chain id of deployment chain')
  .setAction(async ({ chainId }, hre) => {
    const deploymnets = JSON.parse(fs.readFileSync(path.join(__dirname, `ignition/deployments/chain-${chainId}/deployed_addresses.json`)).toString());
    const outputAggregators: any = {}
    const outputProxies: any = {}
    for (const description in uniquePairs) {
      const uuid = description.replace(new RegExp('[+ /().-]', 'g'), '_');
      const accessControlledOffchainAggregatorUuid = "multipleDeploy#accessControlledOffchainAggregator_" + uuid;
      const proxyUuid = "multipleDeploy#Proxy_" + uuid;
      outputAggregators[description] = deploymnets[accessControlledOffchainAggregatorUuid]
      outputProxies[description] = deploymnets[proxyUuid]
    }
    fs.writeFileSync(`./aggregators-${chainId}.json`, JSON.stringify(outputAggregators, undefined, 2));
    fs.writeFileSync(`./proxies-${chainId}.json`, JSON.stringify(outputProxies, undefined, 2));
  });

task("validateFeedPrices").addParam('deviation', 'chain id of deployment chain', "5").setAction(async ({ deviation }, hre) => {
  deviation = Number(deviation)
  console.log("threshold deviation - ", deviation, "%")

  const feedsForCheck = JSON.parse(fs.readFileSync(path.join(__dirname, "test_output_exclude.json")).toString());
  const networkName = hre.network.name
  if (networkName === "opbnbTestnet") {
    const testnetFeeds = JSON.parse(fs.readFileSync(path.join(__dirname, "aggregators-5611.json")).toString());
    for (const feed in feedsForCheck) {
      feedsForCheck[feed] = testnetFeeds[feed]
    }
  } else if (networkName !== "opbnb") {
    throw new Error("support only 'opbnb' and 'opbnbTestnet' networks")
  }

  const uniquePair = JSON.parse(fs.readFileSync(path.join(__dirname, "ignition/data-feeds.json")).toString()).uniquePair

  const addr = "0x73b88119D9F66E33098Eb99BfE51E0763aF3EE1a"
  const contract = await hre.ethers.getContractAt("AccessControlledOffchainAggregator", addr)
  const exceptions = ["ETHFI / USD", "NEIRO / USD", "STBT Proof of Reserves", "AMPL / USD"]

  const infuraAppiKey = process.env.INFURA_API_KEY
  if (!infuraAppiKey) {
    throw new Error("Set INFURA_API_KEY in .env file")
  }

  function getProvider(url: string, addApiKey: boolean = true) {
    if (addApiKey) { url = url + infuraAppiKey }
    return new hre.ethers.JsonRpcProvider(url)
  }

  function attach<T>(contract: T, address: string): T {
    return contract.attach(address)
  }

  const providers: [string: JsonRpcProvider] = {
    "ethereum": getProvider("https://mainnet.infura.io/v3/"),
    "bnb": getProvider("https://bsc-mainnet.infura.io/v3/"),
    "polygon": getProvider("https://polygon-mainnet.infura.io/v3/"),
    "polygon-zkevm": getProvider("https://zkevm-rpc.com", false),
    "arbitrum": getProvider("https://arbitrum-mainnet.infura.io/v3/"),
    "base": getProvider("https://base-mainnet.infura.io/v3/"),
  }

  let okCounter = 0
  let notOkCounter = 0

  for (const feed in feedsForCheck) {
    if (exceptions.includes(feed)) {
      console.log(feed, providers[uniquePair[feed].chainlinkNetwork, uniquePair[feed].chainlinkAddress], " exception: proxy was deprcated by chainlink")
      continue
    }
    try {
      if (uniquePair[feed].chainlinkAddress) {
        const answer = await attach(contract, feedsForCheck[feed]).latestAnswer()
        const answerChainlink = await attach(contract, uniquePair[feed].chainlinkAddress).connect(providers[uniquePair[feed].chainlinkNetwork]).latestAnswer()

        const desimals = Number(uniquePair[feed].decimals)
        const desimalsChainlink = Number(uniquePair[feed].chainlinkDecimals)

        const formatedAnswerChainlink = Number(hre.ethers.formatUnits(answerChainlink.toString(), desimalsChainlink))
        const formatedAnswer = Number(hre.ethers.formatUnits(answer.toString(), desimals))

        const realDeviation = (Math.abs(formatedAnswerChainlink - formatedAnswer) / formatedAnswerChainlink) * 100
        const status = realDeviation > deviation ? "NOT OK" : "OK"

        if (realDeviation > deviation) {
          console.log(feed, "deviation -", realDeviation, "% status -", status)
          console.log("chainlink answer -", formatedAnswerChainlink, "; our feed answer -", formatedAnswer)
          console.log()
          notOkCounter++;
        } else {
          okCounter++
        }
      } else {
        console.log(feed, "not found in uniquePair ignition/data-feeds.json")
        continue
      }
    } catch (e) {
      console.log(feed)
      console.log(e)
    }
  }
  console.log("total feeds count - ", Object.keys(feedsForCheck).length)
  console.log("ok - ", okCounter)
  console.log("not ok - ", notOkCounter)
  console.log("deprecated by chainlink - ", exceptions.length)
});

const DEFAULT_HARDHAT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

const URL_ACCOUNTS_SETTINGS = {
  url: process.env.RPC_URL ?? "",
  accounts: [process.env.DEPLOYER_PRIVATE_KEY ?? DEFAULT_HARDHAT_PRIVATE_KEY],
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{
      version: "0.6.6",
      settings: {
        optimizer: {
          enabled: true,
          runs: 1000000
        }
      }
    },
    {
      version: "0.7.6",
      settings: {
        optimizer: {
          enabled: true,
          runs: 20000
        }
      },
    },
    {
      version: "0.8.30",
      settings: {
        viaIR: true,
        optimizer: {
          enabled: true,
          runs: 5000
        }
      },
    },
    ]
  },
  paths: { sources: "./contract" },
  networks: {
    opbnbTestnet: {
      chainId: 5611,
      ...URL_ACCOUNTS_SETTINGS,
      ignition: {
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 1n,
        disableFeeBumping: true,
      },
    },
    opbnb: {
      chainId: 204,
      ...URL_ACCOUNTS_SETTINGS,
      ignition: {
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 1n,
        disableFeeBumping: true,
      },
    },
  },
  contractSizer: {
    alphaSort: false,
    disambiguatePaths: true,
    runOnCompile: true,
    strict: false,
  },
  etherscan: {
    apiKey: process.env.SCAN_API_KEY,
    customChains: [
      {
        network: 'opbnbTestnet',
        chainId: 5611,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api',
          browserURL: 'https://opbnb-testnet.bscscan.com/',
        },
      },
      {
        network: 'opbnb',
        chainId: 204,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api',
          browserURL: 'https://opbnb.bscscan.com/',
        },
      },
    ],
  },
};

export default config;

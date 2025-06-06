import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL_SOMNIA_TESTNET;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const USDTG_ADDRESS = process.env.USDTG_ADDRESS;
const NIA_ADDRESS = process.env.NIA_ADDRESS;
const ROUTER_ADDRESS = "0xb98c15a0dC1e271132e341250703c7e94c059e8D";
const WSTT_ADDRESS = "0xf22ef0085f6511f70b01a68f360dcc56261f768a";
const NETWORK_NAME = "Somnia Testnet";
const DEBUG_MODE = false;

const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) public payable returns (uint256[])",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) public returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])"
];

const randomAmountRanges = {
  "STT_USDTG": { STT: { min: 0.01, max: 0.05 }, USDTG: { min: 0.04, max: 0.21 } },
  "STT_NIA": { STT: { min: 0.01, max: 0.05 }, NIA: { min: 2, max: 10 } }
};

const globalHeaders = {
  'accept': 'application/json',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'origin': 'https://somnia.exchange',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'referer': 'https://somnia.exchange/',
  'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Opera";v="119"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
};

let walletInfo = {
  address: "",
  balanceStt: "0.00",
  balanceUsdtg: "0.00",
  balanceNia: "0.00",
  points: 0,
  rank: 0,
  network: NETWORK_NAME,
  status: "Initializing"
};

let transactionLogs = [];
let swapRunning = false;
let swapCancelled = false;
let globalWallet = null;
let provider = null;
let lastSwapDirectionSttUsdtg = "USDTG_TO_STT";
let lastSwapDirectionSttNia = "NIA_TO_STT";

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type) {
  if (type === "debug" && !DEBUG_MODE) return;
  const timestamp = new Date().toLocaleTimeString();
  let coloredMessage = message;
  if (type === "swap") coloredMessage = `{bright-cyan-fg}${message}{/bright-cyan-fg}`;
  else if (type === "system") coloredMessage = `{bright-white-fg}${message}{/bright-white-fg}`;
  else if (type === "error") coloredMessage = `{bright-red-fg}${message}{/bright-red-fg}`;
  else if (type === "success") coloredMessage = `{bright-green-fg}${message}{/bright-green-fg}`;
  else if (type === "warning") coloredMessage = `{bright-yellow-fg}${message}{/bright-yellow-fg}`;
  else if (type === "debug") coloredMessage = `{bright-magenta-fg}${message}{/bright-magenta-fg}`;

  transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
  updateLogs();
}

function getRandomDelay() {
  return Math.random() * (60000 - 30000) + 30000;
}

function getRandomNumber(min, max, decimals = 4) {
  const random = Math.random() * (max - min) + min;
  return parseFloat(random.toFixed(decimals));
}

function updateLogs() {
  logsBox.setContent(transactionLogs.join("\n"));
  logsBox.setScrollPerc(100);
  safeRender();
}

function clearTransactionLogs() {
  transactionLogs = [];
  logsBox.setContent("");
  logsBox.setScroll(0);
  updateLogs();
  safeRender();
  addLog("Transaction logs telah dihapus.", "system");
}

async function getTokenBalance(tokenAddress) {
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
    const balance = await contract.balanceOf(globalWallet.address);
    const decimals = await contract.decimals();
    return ethers.formatUnits(balance, decimals);
  } catch (error) {
    addLog(`Gagal mengambil saldo token ${tokenAddress}: ${error.message}`, "error");
    return "0";
  }
}

async function updateWalletData() {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    globalWallet = wallet;
    walletInfo.address = wallet.address;

    const sttBalance = await provider.getBalance(wallet.address);
    walletInfo.balanceStt = ethers.formatEther(sttBalance);

    walletInfo.balanceUsdtg = await getTokenBalance(USDTG_ADDRESS);
    walletInfo.balanceNia = await getTokenBalance(NIA_ADDRESS);

    const apiUrl = `https://api-node.somnia.exchange/api/leaderboard?wallet=${wallet.address}`;
    const response = await fetch(apiUrl, { headers: globalHeaders });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.currentUser) {
        walletInfo.points = data.currentUser.points;
        walletInfo.rank = data.currentUser.rank;
      } else {
        walletInfo.points = 0;
        walletInfo.rank = 0;
      }
    } else {
      addLog(`Gagal mengambil data leaderboard: ${response.statusText}`, "error");
      walletInfo.points = 0;
      walletInfo.rank = 0;
    }

    updateWallet();
    addLog("Informasi Wallet Diperbarui!", "system");
  } catch (error) {
    addLog("Gagal mengambil data wallet: " + error.message, "error");
  }
}

function updateWallet() {
  const shortAddress = walletInfo.address ? getShortAddress(walletInfo.address) : "N/A";
  const stt = walletInfo.balanceStt ? Number(walletInfo.balanceStt).toFixed(4) : "0.0000";
  const usdtg = walletInfo.balanceUsdtg ? Number(walletInfo.balanceUsdtg).toFixed(2) : "0.00";
  const nia = walletInfo.balanceNia ? Number(walletInfo.balanceNia).toFixed(4) : "0.0000";
  const points = walletInfo.points;
  const rank = walletInfo.rank;

  const content = `┌── Address   : {bright-yellow-fg}${shortAddress}{/bright-yellow-fg}
│   ├── STT       : {bright-green-fg}${stt}{/bright-green-fg}
│   ├── USDT.g    : {bright-green-fg}${usdtg}{/bright-green-fg}
│   ├── NIA       : {bright-green-fg}${nia}{/bright-green-fg}
│   ├── Points    : {bright-green-fg}${points}{/bright-green-fg}
│   ├── Rank      : {bright-green-fg}${rank}{/bright-green-fg}
└── Network       : {bright-cyan-fg}${NETWORK_NAME}{/bright-cyan-fg}`;
  walletBox.setContent(content);
  safeRender();
}

async function approveToken(tokenAddress, amountIn) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, globalWallet);
    const allowance = await tokenContract.allowance(globalWallet.address, ROUTER_ADDRESS);
    const decimals = await tokenContract.decimals();
    const amount = ethers.parseUnits(amountIn.toString(), decimals);

    if (allowance < amount) {
      addLog(`Meng-approve ${amountIn} token ${tokenAddress} untuk router...`, "swap");
      const approvalTx = await executeSwapWithNonceRetry(async (nonce) => {
        return await tokenContract.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce });
      }, true);
      await approvalTx.wait();
      addLog(`Token ${tokenAddress} berhasil di-approve.`, "success");
    }
    return true;
  } catch (error) {
    addLog(`Gagal approve token ${tokenAddress}: ${error.message}`, "error");
    return false;
  }
}

async function getAmountOut(amountIn, path) {
  try {
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (error) {
    addLog(`Gagal menghitung amountOut: ${error.message}`, "error");
    return ethers.parseEther("0");
  }
}

async function reportTransaction() {
  try {
    const payload = {
      address: globalWallet.address,
      taskId: "make-swap"
    };
    const response = await fetch("https://api.somnia.exchange/api/completeTask", {
      method: "POST",
      headers: globalHeaders,
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (response.ok && data.success) {
      addLog(`Report Transaction Berhasil: +${data.data.task.actualPointsAwarded} Points`, "success");
      return true;
    } else {
      addLog(`Gagal Report Transaction: ${data.error || response.statusText}`, "error");
      return false;
    }
  } catch (error) {
    addLog(`Gagal Report Transaction: ${error.message}`, "error");
    return false;
  }
}

async function executeSwapWithNonceRetry(txFn, returnTx = false, maxRetries = 3) {
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      let nonce = await provider.getTransactionCount(globalWallet.address, "pending");
      const tx = await txFn(nonce);
      if (returnTx) return tx;
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        return receipt;
      } else {
        throw new Error("Transaksi reverted");
      }
    } catch (error) {
      if (error.message.includes("nonce too low") || error.message.includes("nonce has already been used") || error.message.includes("reverted")) {
        addLog(`Transaksi gagal (percobaan ${retry + 1}): ${error.message}. Mengambil nonce terbaru...`, "warning");
        if (retry === maxRetries - 1) {
          throw new Error(`Gagal setelah ${maxRetries} percobaan: ${error.message}`);
        }
        continue;
      } else {
        throw error;
      }
    }
  }
}

async function autoSwapSttUsdtg() {
  try {
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, globalWallet);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const sttBalance = parseFloat(walletInfo.balanceStt);
    const usdtgBalance = parseFloat(walletInfo.balanceUsdtg);
    const sttAmount = getRandomNumber(0.01, 0.05, 4);
    const usdtgAmount = getRandomNumber(0.04, 0.21, 4);

    addLog(`Arah swap saat ini: ${lastSwapDirectionSttUsdtg}`, "debug");
    addLog(`Saldo: STT=${sttBalance}, USDT.g=${usdtgBalance}`, "debug");

    let receipt;

    if (lastSwapDirectionSttUsdtg === "USDTG_TO_STT") {
      if (sttBalance < sttAmount) {
        addLog(`Saldo STT tidak cukup: ${sttBalance} < ${sttAmount}`, "warning");
        return false;
      }

      const amountIn = ethers.parseEther(sttAmount.toString());
      const path = [WSTT_ADDRESS, USDTG_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      addLog(`Melakukan swap ${sttAmount} STT ➯ USDT.g`, "swap");

      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactETHForTokens(
          slippage,
          path,
          globalWallet.address,
          deadline,
          { value: amountIn, gasLimit: 300000, nonce }
        );
      });

      if (receipt.status === 1) {
        addLog(`Swap Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttUsdtg = "STT_TO_USDTG";
        addLog(`Arah swap diubah ke: ${lastSwapDirectionSttUsdtg}`, "debug");
        return true;
      }
    } else {
      if (usdtgBalance < usdtgAmount) {
        addLog(`Saldo USDT.g tidak cukup: ${usdtgBalance} < ${usdtgAmount}`, "warning");
        return false;
      }

      const tokenContract = new ethers.Contract(USDTG_ADDRESS, ERC20ABI, globalWallet);
      const decimals = await tokenContract.decimals();
      const amountIn = ethers.parseUnits(usdtgAmount.toString(), decimals);
      const path = [USDTG_ADDRESS, WSTT_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      const approved = await approveToken(USDTG_ADDRESS, usdtgAmount);
      if (!approved) return false;

      addLog(`Melakukan swap ${usdtgAmount} USDT.g ➯ STT`, "swap");

      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactTokensForETH(
          amountIn,
          slippage,
          path,
          globalWallet.address,
          deadline,
          { gasLimit: 300000, nonce }
        );
      });

      if (receipt.status === 1) {
        addLog(`Swap Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttUsdtg = "USDTG_TO_STT";
        addLog(`Arah swap diubah ke: ${lastSwapDirectionSttUsdtg}`, "debug");
        return true;
      }
    }
    return false;
  } catch (error) {
    addLog(`Gagal melakukan swap: ${error.message}`, "error");
    return false;
  }
}

async function autoSwapSttNia() {
  try {
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, globalWallet);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const sttBalance = parseFloat(walletInfo.balanceStt);
    const niaBalance = parseFloat(walletInfo.balanceNia);
    const sttAmount = getRandomNumber(0.01, 0.05, 4);
    const niaAmount = getRandomNumber(2, 10, 4);

    addLog(`Arah swap saat ini: ${lastSwapDirectionSttNia}`, "debug");
    addLog(`Saldo: STT=${sttBalance}, NIA=${niaBalance}`, "debug");

    let receipt;

    if (lastSwapDirectionSttNia === "NIA_TO_STT") {
      if (sttBalance < sttAmount) {
        addLog(`Saldo STT tidak cukup: ${sttBalance} < ${sttAmount}`, "warning");
        return false;
      }

      const amountIn = ethers.parseEther(sttAmount.toString());
      const path = [WSTT_ADDRESS, NIA_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      addLog(`Melakukan swap ${sttAmount} STT ➯ NIA`, "swap");

      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactETHForTokens(
          slippage,
          path,
          globalWallet.address,
          deadline,
          { value: amountIn, gasLimit: 300000, nonce }
        );
      });

      if (receipt.status === 1) {
        addLog(`Swap Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttNia = "STT_TO_NIA";
        addLog(`Arah swap diubah ke: ${lastSwapDirectionSttNia}`, "debug");
        return true;
      }
    } else {
      if (niaBalance < niaAmount) {
        addLog(`Saldo NIA tidak cukup: ${niaBalance} < ${niaAmount}`, "warning");
        return false;
      }

      const tokenContract = new ethers.Contract(NIA_ADDRESS, ERC20ABI, globalWallet);
      const decimals = await tokenContract.decimals();
      const amountIn = ethers.parseUnits(niaAmount.toString(), decimals);
      const path = [NIA_ADDRESS, WSTT_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      const approved = await approveToken(NIA_ADDRESS, niaAmount);
      if (!approved) return false;

      addLog(`Melakukan swap ${niaAmount} NIA ➯ STT`, "swap");

      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactTokensForETH(
          amountIn,
          slippage,
          path,
          globalWallet.address,
          deadline,
          { gasLimit: 300000, nonce }
        );
      });

      if (receipt.status === 1) {
        addLog(`Swap Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttNia = "NIA_TO_STT";
        addLog(`Arah swap diubah ke: ${lastSwapDirectionSttNia}`, "debug");
        return true;
      }
    }
    return false;
  } catch (error) {
    addLog(`Gagal melakukan swap: ${error.message}`, "error");
    return false;
  }
}

async function runAutoSwap(pair, autoSwapFunction, lastSwapDirection) {
  promptBox.setFront();
  promptBox.readInput(`Masukkan jumlah swap untuk ${pair}`, "", async (err, value) => {
    promptBox.hide();
    safeRender();
    if (err || !value) {
      addLog(`Somnia Exchange: Input tidak valid atau dibatalkan untuk ${pair}.`, "swap");
      return;
    }
    const loopCount = parseInt(value);
    if (isNaN(loopCount)) {
      addLog(`Somnia Exchange: Input harus berupa angka untuk ${pair}.`, "swap");
      return;
    }
    addLog(`Somnia Exchange: Mulai ${loopCount} iterasi swap untuk ${pair}.`, "swap");

    swapRunning = true;
    swapCancelled = false;
    mainMenu.setItems(getMainMenuItems());
    somniaExchangeSubMenu.setItems(getSomniaExchangeMenuItems());
    somniaExchangeSubMenu.show();
    safeRender();

    for (let i = 1; i <= loopCount; i++) {
      if (swapCancelled) {
        addLog(`Somnia Exchange: Auto Swap ${pair} Dihentikan pada Cycle ${i}.`, "swap");
        break;
      }
      addLog(`Memulai swap ke-${i} untuk ${pair}`, "swap");
      const success = await autoSwapFunction();
      if (success) {
        await updateWalletData();
      }
      if (i < loopCount && !swapCancelled) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        addLog(`Swap ke-${i} Selesai. Menunggu ${minutes} menit ${seconds} detik.`, "swap");

        const startTime = Date.now();
        while (Date.now() - startTime < delayTime) {
          if (swapCancelled) {
            addLog(`Somnia Exchange: Dihentikan saat periode tunggu untuk ${pair}.`, "swap");
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (swapCancelled) break;
      }
    }
    swapRunning = false;
    swapCancelled = false;
    mainMenu.setItems(getMainMenuItems());
    somniaExchangeSubMenu.setItems(getSomniaExchangeMenuItems());
    safeRender();
    addLog(`Somnia Exchange: Auto Swap untuk ${pair} selesai.`, "swap");
  });
}

function changeRandomAmount(pair) {
  const pairKey = pair.replace(" & ", "_");
  const token2 = pair.split(" & ")[1];
  promptBox.setFront();
  promptBox.input(`Masukkan rentang random amount untuk STT pada pasangan ${pair} (format: min,max, contoh: 0.1,0.5)`, "", (err, valueStt) => {
    promptBox.hide();
    safeRender();
    if (err || !valueStt) {
      addLog(`Change Random Amount: Input untuk STT pada ${pair} dibatalkan.`, "system");
      changeRandomAmountSubMenu.show();
      changeRandomAmountSubMenu.focus();
      safeRender();
      return;
    }
    const [minStt, maxStt] = valueStt.split(",").map(v => parseFloat(v.trim()));
    if (isNaN(minStt) || isNaN(maxStt) || minStt <= 0 || maxStt <= minStt) {
      addLog(`Change Random Amount: Input tidak valid untuk STT pada ${pair}. Gunakan format min,max (contoh: 0.1,0.5) dengan min > 0 dan max > min.`, "error");
      changeRandomAmountSubMenu.show();
      changeRandomAmountSubMenu.focus();
      safeRender();
      return;
    }

    promptBox.setFront();
    promptBox.input(`Masukkan rentang random amount untuk ${token2} pada pasangan ${pair} (format: min,max, contoh: 0.1,0.5)`, "", (err, valueToken2) => {
      promptBox.hide();
      safeRender();
      if (err || !valueToken2) {
        addLog(`Change Random Amount: Input untuk ${token2} pada ${pair} dibatalkan.`, "system");
        changeRandomAmountSubMenu.show();
        changeRandomAmountSubMenu.focus();
        safeRender();
        return;
      }
      const [minToken2, maxToken2] = valueToken2.split(",").map(v => parseFloat(v.trim()));
      if (isNaN(minToken2) || isNaN(maxToken2) || minToken2 <= 0 || maxToken2 <= minToken2) {
        addLog(`Change Random Amount: Input tidak valid untuk ${token2} pada ${pair}. Gunakan format min,max (contoh: 0.1,0.5) dengan min > 0 dan max > min.`, "error");
        changeRandomAmountSubMenu.show();
        changeRandomAmountSubMenu.focus();
        safeRender();
        return;
      }

      randomAmountRanges[pairKey] = {
        STT: { min: minStt, max: maxStt },
        [token2]: { min: minToken2, max: maxToken2 }
      };
      addLog(`Change Random Amount: Random Amount ${pair} diubah menjadi STT: ${minStt} - ${maxStt}, ${token2}: ${minToken2} - ${maxToken2}.`, "success");
      changeRandomAmountSubMenu.show();
      changeRandomAmountSubMenu.focus();
      safeRender();
    });
  });
}

const screen = blessed.screen({
  smartCSR: true,
  title: "Somnia Exchange",
  fullUnicode: true,
  mouse: true
});

let renderTimeout;

function safeRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => { screen.render(); }, 50);
}

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  tags: true,
  style: { fg: "white", bg: "default" }
});

figlet.text("ANNISA".toUpperCase(), { font: "ANSI Shadow" }, (err, data) => {
  if (err) {
    headerBox.setContent("{center}{bold}Somniaazzahra123{/bold}{/center}");
  } else {
    const lines = data.split("\n");
    const half = Math.floor(lines.length / 2);
    const coloredLines = lines.map((line, index) => {
      if (index < half) {
        return `{red-fg}${line}{/red-fg}`;
      } else {
        return `{white-fg}${line}{/white-fg}`;
      }
    });
    const coloredText = coloredLines.join("\n");
    headerBox.setContent(`{center}{bold}${coloredText}{/bold}{/center}`);
  }
  safeRender();
});

const descriptionBox = blessed.box({
  left: "center",
  width: "100%",
  content: "{center}{bold}{bright-yellow-fg}✦ ✦ SOMNIA EXCHANGE ✦ ✦{/bright-yellow-fg}{/bold}{/center}",
  tags: true,
  style: { fg: "white", bg: "default" }
});

const logsBox = blessed.box({
  label: " Transaction ",
  left: 0,
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  style: { border: { fg: "red" }, fg: "white" },
  scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
  content: ""
});

const walletBox = blessed.box({
  label: " Wallet ",
  border: { type: "line" },
  tags: true,
  style: { border: { fg: "magenta" }, fg: "white", bg: "default" },
  content: "loading..."
});

const mainMenu = blessed.list({
  label: " Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "green", fg: "black" } },
  items: getMainMenuItems()
});

function getMainMenuItems() {
  let items = [];
  if (swapRunning) items.push("Stop");
  items = items.concat(["Somnia Exchange", "Clear Transaction Logs", "Refresh", "Exit"]);
  return items;
}

function getSomniaExchangeMenuItems() {
  let items = [];
  if (swapRunning) items.push("Stop Transaction");
  items = items.concat([
    "Auto Swap STT & USDT.g",
    "Auto Swap STT & NIA",
    "Change Random Amount",
    "Clear Transaction Logs",
    "Back To Main Menu",
    "Refresh"
  ]);
  return items;
}

const somniaExchangeSubMenu = blessed.list({
  label: " Somnia Exchange Main ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  tags: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "cyan", fg: "black" } },
  items: getSomniaExchangeMenuItems()
});
somniaExchangeSubMenu.hide();

const changeRandomAmountSubMenu = blessed.list({
  label: " Change Random Amount ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  tags: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "cyan", fg: "black" } },
  items: ["STT & USDT.g", "STT & NIA", "Back To Somnia Exchange Menu"]
});
changeRandomAmountSubMenu.hide();

const promptBox = blessed.prompt({
  parent: screen,
  border: "line",
  height: 5,
  width: "60%",
  top: "center",
  left: "center",
  label: "{bright-blue-fg}Prompt{/bright-blue-fg}",
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  style: { fg: "bright-red", bg: "default", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(descriptionBox);
screen.append(logsBox);
screen.append(walletBox);
screen.append(mainMenu);
screen.append(somniaExchangeSubMenu);
screen.append(changeRandomAmountSubMenu);

function adjustLayout() {
  const screenHeight = screen.height;
  const screenWidth = screen.width;
  const headerHeight = Math.max(8, Math.floor(screenHeight * 0.15));
  headerBox.top = 0;
  headerBox.height = headerHeight;
  headerBox.width = "100%";
  descriptionBox.top = "23%";
  descriptionBox.height = Math.floor(screenHeight * 0.05);
  logsBox.top = headerHeight + descriptionBox.height;
  logsBox.left = 0;
  logsBox.width = Math.floor(screenWidth * 0.6);
  logsBox.height = screenHeight - (headerHeight + descriptionBox.height);
  walletBox.top = headerHeight + descriptionBox.height;
  walletBox.left = Math.floor(screenWidth * 0.6);
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  mainMenu.top = headerHeight + descriptionBox.height + walletBox.height;
  mainMenu.left = Math.floor(screenWidth * 0.6);
  mainMenu.width = Math.floor(screenWidth * 0.4);
  mainMenu.height = screenHeight - (headerHeight + descriptionBox.height + walletBox.height);
  somniaExchangeSubMenu.top = mainMenu.top;
  somniaExchangeSubMenu.left = mainMenu.left;
  somniaExchangeSubMenu.width = mainMenu.width;
  somniaExchangeSubMenu.height = mainMenu.height;
  changeRandomAmountSubMenu.top = mainMenu.top;
  changeRandomAmountSubMenu.left = mainMenu.left;
  changeRandomAmountSubMenu.width = mainMenu.width;
  changeRandomAmountSubMenu.height = mainMenu.height;
  safeRender();
}

screen.on("resize", adjustLayout);
adjustLayout();

mainMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Somnia Exchange") {
    somniaExchangeSubMenu.show();
    somniaExchangeSubMenu.focus();
    safeRender();
  } else if (selected === "Stop Transaction") {
    if (swapRunning) {
      swapCancelled = true;
      addLog("Stop Transaction: Transaksi swap akan dihentikan.", "system");
    }
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Refresh") {
    updateWalletData();
    safeRender();
    addLog("Refreshed", "system");
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

somniaExchangeSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Auto Swap STT & USDT.g") {
    if (swapRunning) {
      addLog("Transaksi Somnia Exchange berjalan. Hentikan transaki.", "warning");
    } else {
      runAutoSwap("STT & USDT.g", autoSwapSttUsdtg, lastSwapDirectionSttUsdtg);
    }
  } else if (selected === "Auto Swap STT & NIA") {
    if (swapRunning) {
      addLog("Transaksi Somnia Exchange berjalan. Hentikan transaksi.", "warning");
    } else {
      runAutoSwap("STT & NIA", autoSwapSttNia, lastSwapDirectionSttNia);
    }
  } else if (selected === "Change Random Amount") {
    somniaExchangeSubMenu.hide();
    changeRandomAmountSubMenu.show();
    changeRandomAmountSubMenu.focus();
    safeRender();
  } else if (selected === "Stop Transaction") {
    if (swapRunning) {
      swapCancelled = true;
      addLog("Somnia Exchange: Perintah Stop Transaction diterima.", "swap");
    } else {
      addLog("Somnia Exchange: Tidak ada transaksi yang berjalan.", "swap");
    }
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    somniaExchangeSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Refresh") {
    updateWalletData();
    safeRender();
    addLog("Refreshed", "system");
  }
});

changeRandomAmountSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "STT & USDT.g") {
    changeRandomAmount("STT & USDT.g");
  } else if (selected === "STT & NIA") {
    changeRandomAmount("STT & NIA");
  } else if (selected === "Back To Somnia Exchange Menu") {
    changeRandomAmountSubMenu.hide();
    somniaExchangeSubMenu.show();
    somniaExchangeSubMenu.focus();
    safeRender();
  }
});

screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.key(["C-up"], () => { logsBox.scroll(-1); safeRender(); });
screen.key(["C-down"], () => { logsBox.scroll(1); safeRender(); });

safeRender();
mainMenu.focus();
addLog("contact Telegram @Somniaazzahra123!!", "system");
updateWalletData();

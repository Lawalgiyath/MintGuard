import { JsonRpcProvider, Contract } from 'ethers';
const cc = new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network');
const WRAPPED = '0x1f42B80ebac56AF3f023997A4240D3B97476A557';
const c = new Contract(WRAPPED, ['function totalSupply() view returns (uint256)'], cc);
for (let i = 0; i < 120; i++) {
  try {
    const s = await c.totalSupply();
    if (s > 0n) { console.log(`MINTED totalSupply=${Number(s)/1e18} wmTUSD`); process.exit(0); }
  } catch (e) {}
  await new Promise(r => setTimeout(r, 15000));
}
console.log('TIMEOUT waiting for mint');
process.exit(1);

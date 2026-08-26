import { JsonRpcProvider, Contract } from 'ethers';
const cc = new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network');
const ABI = ['function reserves(address) view returns (uint256,uint256,uint64,uint64,uint64,bool)'];
const ASC = '0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8';
const ASSET = '0x91FAF68A9E5C0e013b5c01b7AACF4C841A6382f8';
const c = new Contract(ASC, ABI, cc);
for (let i = 0; i < 120; i++) {
  try {
    const r = await c.reserves(ASSET);
    if (r[2] > 0n) {
      console.log(`PROVEN balance=${Number(r[0])/1e18} atHeight=${r[2]} epoch=${r[4]}`);
      process.exit(0);
    }
  } catch (e) {}
  await new Promise(r => setTimeout(r, 15000));
}
console.log('TIMEOUT waiting for first proof');
process.exit(1);

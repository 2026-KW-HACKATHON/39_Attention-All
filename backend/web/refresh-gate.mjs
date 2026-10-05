export class RefreshGate{constructor(){this.version=0;}start(){const version=++this.version;return ()=>version===this.version;}invalidate(){this.version++;}}

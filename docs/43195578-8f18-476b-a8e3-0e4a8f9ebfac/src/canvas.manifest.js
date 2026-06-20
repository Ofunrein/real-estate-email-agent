export const manifest = {
  screens: {
    scr_cu2la2: { name: "Overview", route: "/", state: { "channel": "all" }, position: { "x": 160, "y": 1820 } },
    scr_vvdv9z: { name: "Email", route: "/", state: { "channel": "email" }, position: { "x": 1560, "y": 1820 } },
    scr_z18xh6: { name: "SMS", route: "/", state: { "channel": "sms" }, position: { "x": 2960, "y": 1820 } },
    scr_t83lmd: { name: "Voice", route: "/", state: { "channel": "voice" }, position: { "x": 4360, "y": 1820 } },
    scr_xeh7xg: { name: "Instagram", route: "/", state: { "channel": "instagram" }, position: { "x": 5760, "y": 1820 } },
    scr_t01hsu: { name: "Messenger", route: "/", state: { "channel": "messenger" }, position: { "x": 7160, "y": 1820 } },
    scr_ixte50: { name: "WhatsApp", route: "/", state: { "channel": "whatsapp" }, position: { "x": 8560, "y": 1820 } },
    scr_tbeab0: { name: "Website", route: "/", state: { "channel": "website" }, position: { "x": 9960, "y": 1820 } },
    scr_5y3z1x: { name: "Properties", route: "/", state: { "channel": "properties" }, position: { "x": 0, "y": 0 }, isDefaultRow: true }
  },
  sections: {
    sec_kflh6l: { name: "Communication Channels", x: 0, y: 1600, width: 11320, height: 1180 }
  },
  layers: [
  { kind: "screen", id: "scr_5y3z1x" },
  { kind: "section", id: "sec_kflh6l", children: [
    { kind: "screen", id: "scr_cu2la2" },
    { kind: "screen", id: "scr_vvdv9z" },
    { kind: "screen", id: "scr_z18xh6" },
    { kind: "screen", id: "scr_t83lmd" },
    { kind: "screen", id: "scr_xeh7xg" },
    { kind: "screen", id: "scr_t01hsu" },
    { kind: "screen", id: "scr_ixte50" },
    { kind: "screen", id: "scr_tbeab0" }]
  }]

};
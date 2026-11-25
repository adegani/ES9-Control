//! Reassembly of MIDI System Exclusive messages.
//!
//! Some backends (notably CoreMIDI) may deliver a long SysEx message split
//! across several packets. The ES-9 config dump is >1 KB, so the input
//! callback feeds every packet through this assembler and only forwards
//! complete `F0 … F7` frames to the UI.

const SYSEX_START: u8 = 0xF0;
const SYSEX_END: u8 = 0xF7;
/// Upper bound to avoid unbounded growth on a malformed stream.
const MAX_SYSEX_LEN: usize = 64 * 1024;

#[derive(Default)]
pub struct SysexAssembler {
    buf: Vec<u8>,
    active: bool,
}

impl SysexAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed raw bytes; returns every complete SysEx message found.
    /// Non-SysEx bytes (channel messages, clock, …) are ignored.
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for &b in data {
            if b == SYSEX_START {
                // A new start always restarts assembly (an unterminated
                // previous message is discarded).
                self.buf.clear();
                self.buf.push(b);
                self.active = true;
            } else if !self.active {
                continue;
            } else if b == SYSEX_END {
                self.buf.push(b);
                out.push(std::mem::take(&mut self.buf));
                self.active = false;
            } else if b >= 0xF8 {
                // Real-time messages may be interleaved; skip them.
                continue;
            } else if b & 0x80 != 0 {
                // Any other status byte aborts the SysEx.
                self.buf.clear();
                self.active = false;
            } else {
                self.buf.push(b);
                if self.buf.len() > MAX_SYSEX_LEN {
                    self.buf.clear();
                    self.active = false;
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_packet() {
        let mut a = SysexAssembler::new();
        let msgs = a.feed(&[0xF0, 0x00, 0x21, 0x27, 0x19, 0x22, 0xF7]);
        assert_eq!(msgs, vec![vec![0xF0, 0x00, 0x21, 0x27, 0x19, 0x22, 0xF7]]);
    }

    #[test]
    fn split_across_packets() {
        let mut a = SysexAssembler::new();
        assert!(a.feed(&[0xF0, 0x00, 0x21]).is_empty());
        assert!(a.feed(&[0x27, 0x19]).is_empty());
        let msgs = a.feed(&[0x10, 0x01, 0xF7]);
        assert_eq!(msgs, vec![vec![0xF0, 0x00, 0x21, 0x27, 0x19, 0x10, 0x01, 0xF7]]);
    }

    #[test]
    fn ignores_channel_and_realtime() {
        let mut a = SysexAssembler::new();
        let msgs = a.feed(&[0x90, 0x40, 0x7F, 0xF0, 0x01, 0xF8, 0x02, 0xF7, 0x80, 0x40, 0x00]);
        assert_eq!(msgs, vec![vec![0xF0, 0x01, 0x02, 0xF7]]);
    }

    #[test]
    fn multiple_in_one_packet() {
        let mut a = SysexAssembler::new();
        let msgs = a.feed(&[0xF0, 0x01, 0xF7, 0xF0, 0x02, 0xF7]);
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn status_byte_aborts() {
        let mut a = SysexAssembler::new();
        let msgs = a.feed(&[0xF0, 0x01, 0x90, 0x02, 0xF7]);
        assert!(msgs.is_empty());
    }
}

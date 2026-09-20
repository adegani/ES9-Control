import customtkinter as ctk
import mido

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

# Header SysEx Expert Sleepers per ES-9: F0 00 21 27 19 ... F7
SYSEX_HEADER = [0x00, 0x21, 0x27, 0x19]

DSP_INPUT_OPTIONS = {
    **{f"Analogue In {channel}": channel - 1 for channel in range(1, 15)},
    "S/PDIF In L": 14,
    "S/PDIF In R": 15,
    **{f"USB Audio Output {channel}": 0x10 + channel - 1 for channel in range(1, 17)},
    **{f"Mixer 1 Output {channel}": 0x20 + channel for channel in range(16)},
    **{f"Mixer 2 Output {channel}": 0x30 + channel for channel in range(16)},
}

DSP_OUTPUT_OPTIONS = {
    "Main Out L": 0,
    "Main Out R": 1,
    "Phones Out L": 2,
    "Phones Out R": 3,
    **{f"Eurorack Out {channel}": 3 + channel for channel in range(1, 9)},
    "S/PDIF Out L": 12,
    "S/PDIF Out R": 13,
    **{f"USB Audio Input {channel}": 0x10 + channel - 1 for channel in range(1, 17)},
    **{f"Mixer 1 Input {channel}": 0x20 + channel for channel in range(16)},
    **{f"Mixer 2 Input {channel}": 0x30 + channel for channel in range(16)},
}

DSP_LOGICAL_GROUPS = {
    "USB Audio": {
        "count": 16,
        "input_endpoints": [f"USB Audio Input {channel}" for channel in range(1, 17)],
        "output_endpoints": [f"USB Audio Output {channel}" for channel in range(1, 17)],
        "inputs": DSP_INPUT_OPTIONS,
        "outputs": DSP_OUTPUT_OPTIONS,
    },
    "Mixer 1": {
        "count": 8,
        "input_endpoints": [f"Mixer 1 Input {channel}" for channel in range(8)],
        "output_endpoints": [f"Mixer 1 Output {channel}" for channel in range(8)],
        "inputs": DSP_INPUT_OPTIONS,
        "outputs": DSP_OUTPUT_OPTIONS,
    },
    "Mixer 2 / S/PDIF": {
        "count": 8,
        "input_endpoints": [f"Mixer 2 Input {channel}" for channel in range(8)],
        "output_endpoints": [f"Mixer 2 Output {channel}" for channel in range(8)],
        "inputs": DSP_INPUT_OPTIONS,
        "outputs": DSP_OUTPUT_OPTIONS,
        "spdif_input_endpoints": ["S/PDIF In L", "S/PDIF In R"],
        "spdif_output_endpoints": ["S/PDIF Out L", "S/PDIF Out R"],
        "spdif_inputs": {"S/PDIF In L": 14, "S/PDIF In R": 15},
        "spdif_outputs": {"S/PDIF Out L": 12, "S/PDIF Out R": 13},
    },
}


def int_to_3bytes(value: int) -> list[int]:
    """Converte un intero (0..16383 o 24bit) in 3 byte MIDI a 7-bit (MSB -> LSB)."""
    val = max(0, min(0x1FFFFF, value))
    b0 = (val >> 14) & 0x7F
    b1 = (val >> 7) & 0x7F
    b2 = val & 0x7F
    return [b0, b1, b2]


class ES9TotalHardwareController(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Expert Sleepers ES-9 Full Controller Pro")
        self.geometry("1000x780")

        self.midi_output = None
        self.midi_input = None

        # --- TOP HEADER & MIDI SELECTION ---
        self.setup_header()

        # --- SYSTEM TOOLBAR (Flash / Reset / Info) ---
        self.setup_system_bar()

        # --- TAB VIEW PRINCIPALE ---
        self.tabview = ctk.CTkTabview(self)
        self.tabview.pack(fill="both", expand=True, padx=15, pady=10)

        self.tab_matrix = self.tabview.add("Matrix Mixer (60H-6FH)")
        self.tab_dsp = self.tabview.add("DSP Routing (40H-53H)")
        self.tab_dc = self.tabview.add("DC Blocking & Offset (31H/36H)")
        self.tab_options = self.tabview.add("Global Options & MIDI (32H/35H)")

        # Inizializza le schede
        self.setup_matrix_tab()
        self.setup_dsp_tab()
        self.setup_dc_tab()
        self.setup_options_tab()

        # Tenta connessione automatica
        self.refresh_midi_ports()

    def send_sysex(self, cmd_bytes: list[int]):
        """Invia un messaggio SysEx preceduto dall'header ES-9."""
        if self.midi_output:
            full_data = SYSEX_HEADER + cmd_bytes
            msg = mido.Message('sysex', data=full_data)
            self.midi_output.send(msg)

    # --- HEADER & CONNESSIO NE MIDI ---
    def setup_header(self):
        header_frame = ctk.CTkFrame(self)
        header_frame.pack(fill="x", padx=15, pady=(10, 5))

        title = ctk.CTkLabel(header_frame, text="EXPERT SLEEPERS ES-9 HARDWARE CONTROL", font=("Arial", 16, "bold"))
        title.pack(side="top", pady=5)

        conn_frame = ctk.CTkFrame(header_frame, fg_color="transparent")
        conn_frame.pack(fill="x", pady=5, padx=10)

        ctk.CTkLabel(conn_frame, text="MIDI Out:").pack(side="left", padx=5)
        self.combo_out = ctk.CTkOptionMenu(conn_frame, command=self.on_select_output)
        self.combo_out.pack(side="left", padx=5)

        ctk.CTkLabel(conn_frame, text="MIDI In:").pack(side="left", padx=(15, 5))
        self.combo_in = ctk.CTkOptionMenu(conn_frame, command=self.on_select_input)
        self.combo_in.pack(side="left", padx=5)

        btn_refresh = ctk.CTkButton(conn_frame, text="Refresh Ports", width=100, command=self.refresh_midi_ports)
        btn_refresh.pack(side="right", padx=5)

        self.status_label = ctk.CTkLabel(self, text="Status: Disconnected", text_color="orange")
        self.status_label.pack(pady=2)

    def refresh_midi_ports(self):
        try:
            outputs = mido.get_output_names()
            inputs = mido.get_input_names()

            self.combo_out.configure(values=outputs if outputs else ["Nessuna porta"])
            self.combo_in.configure(values=inputs if inputs else ["Nessuna porta"])

            es9_out = next((p for p in outputs if "ES-9" in p or "ES9" in p), outputs[0] if outputs else None)
            es9_in = next((p for p in inputs if "ES-9" in p or "ES9" in p), inputs[0] if inputs else None)

            if es9_out:
                self.combo_out.set(es9_out)
                self.on_select_output(es9_out)
            if es9_in:
                self.combo_in.set(es9_in)
                self.on_select_input(es9_in)
        except Exception as e:
            self.status_label.configure(text=f"Errore ricerca porte: {e}", text_color="red")

    def on_select_output(self, port_name):
        try:
            if self.midi_output:
                self.midi_output.close()
            self.midi_output = mido.open_output(port_name)
            self.update_status()
        except Exception as e:
            self.status_label.configure(text=f"Errore apertura Out {port_name}: {e}", text_color="red")

    def on_select_input(self, port_name):
        try:
            if self.midi_input:
                self.midi_input.close()
            self.midi_input = mido.open_input(port_name, callback=self.on_midi_receive)
            self.update_status()
        except Exception as e:
            self.status_label.configure(text=f"Errore apertura In {port_name}: {e}", text_color="red")

    def update_status(self):
        if self.midi_output:
            self.status_label.configure(text=f"Connesso: OUT={self.midi_output.name}", text_color="green")
        else:
            self.status_label.configure(text="Scollegato", text_color="red")

    def on_midi_receive(self, msg):
        """Callback per i messaggi SysEx ricevuti dall'ES-9 (es. 32H String/Status, 14H Sample Rate)."""
        if msg.type == 'sysex' and list(msg.data[:4]) == SYSEX_HEADER:
            msg_type = msg.data[4]
            if msg_type == 0x32:  # Message ASCII string response
                txt = "".join(chr(b) for b in msg.data[5:] if b != 0)
                print(f"[ES-9 Response]: {txt}")
            elif msg_type == 0x14:  # Sample Rate response
                sr = (msg.data[5] << 14) | (msg.data[6] << 7) | msg.data[7]
                print(f"[ES-9 Sample Rate]: {sr} Hz")

    # --- SYSTEM TOOLBAR ---
    def setup_system_bar(self):
        sys_frame = ctk.CTkFrame(self, fg_color="transparent")
        sys_frame.pack(fill="x", padx=15, pady=2)

        ctk.CTkButton(sys_frame, text="Save Standalone (24H)", width=130, command=lambda: self.send_sysex([0x24, 0x00])).pack(side="left", padx=3)
        ctk.CTkButton(sys_frame, text="Save Hosted (24H)", width=130, command=lambda: self.send_sysex([0x24, 0x01])).pack(side="left", padx=3)
        ctk.CTkButton(sys_frame, text="Restore (25H)", width=110, command=lambda: self.send_sysex([0x25, 0x00])).pack(side="left", padx=3)
        ctk.CTkButton(sys_frame, text="Reset Defaults (26H)", width=130, fg_color="darkred", command=lambda: self.send_sysex([0x26])).pack(side="left", padx=3)

        ctk.CTkButton(sys_frame, text="Req Version (22H)", width=120, command=lambda: self.send_sysex([0x22])).pack(side="right", padx=3)
        ctk.CTkButton(sys_frame, text="Req Rate (2CH)", width=110, command=lambda: self.send_sysex([0x2C])).pack(side="right", padx=3)

    # --- 1. TAB: MATRIX MIXER (60H-6FH) ---
    def setup_matrix_tab(self):
        top_bar = ctk.CTkFrame(self.tab_matrix)
        top_bar.pack(fill="x", padx=10, pady=5)

        ctk.CTkLabel(top_bar, text="Seleziona ID Mix (0 - 15):", font=("Arial", 12, "bold")).pack(side="left", padx=10)
        self.current_mix_id = 0
        mix_options = [f"Mix {i}" for i in range(16)]
        self.mix_selector = ctk.CTkOptionMenu(top_bar, values=mix_options, command=self.on_mix_select)
        self.mix_selector.pack(side="left", padx=10)

        # Virtual Mix Control (34H)
        ctk.CTkLabel(top_bar, text="Virtual Mix Level (34H):").pack(side="left", padx=(30, 5))
        self.virt_mix_slider = ctk.CTkSlider(top_bar, from_=0, to=127, command=self.on_virtual_mix_change)
        self.virt_mix_slider.set(0)
        self.virt_mix_slider.pack(side="left", padx=5)

        # Sub-frame faders per i 8 canali del Mix attivo
        self.faders_frame = ctk.CTkFrame(self.tab_matrix)
        self.faders_frame.pack(fill="both", expand=True, padx=10, pady=10)

        self.mix_sliders = []
        for ch in range(8):
            ch_box = ctk.CTkFrame(self.faders_frame)
            ch_box.pack(side="left", fill="both", expand=True, padx=4, pady=5)

            ctk.CTkLabel(ch_box, text=f"Ch {ch}", font=("Arial", 11, "bold")).pack(pady=5)

            slider = ctk.CTkSlider(
                ch_box, orientation="vertical", from_=0, to=16383, number_of_steps=128,
                command=lambda val, c=ch: self.on_fader_change(c, val)
            )
            slider.set(0)
            slider.pack(expand=True, fill="y", pady=10)

            lbl_val = ctk.CTkLabel(ch_box, text="0")
            lbl_val.pack(pady=5)

            self.mix_sliders.append({"slider": slider, "label": lbl_val})

    def on_mix_select(self, val_str):
        self.current_mix_id = int(val_str.split()[-1])

    def on_fader_change(self, channel, val):
        int_val = int(val)
        self.mix_sliders[channel]["label"].configure(text=str(int_val))
        bytes3 = int_to_3bytes(int_val)
        # Comando 60H + mix_id
        cmd = [0x60 + self.current_mix_id, channel] + bytes3
        self.send_sysex(cmd)

    def on_virtual_mix_change(self, val):
        # Comando 34H <mix> <level>
        self.send_sysex([0x34, self.current_mix_id, int(val)])

    # --- 2. TAB: DSP ROUTING (40H-43H & 50H-53H) ---
    def setup_dsp_tab(self):
        toolbar = ctk.CTkFrame(self.tab_dsp)
        toolbar.pack(fill="x", padx=10, pady=(10, 4))

        ctk.CTkLabel(toolbar, text="Logical DSP routing", font=("Arial", 13, "bold")).pack(side="left", padx=8)
        ctk.CTkButton(toolbar, text="Set routing", width=110, command=self.send_dsp_logical_routing).pack(side="right", padx=8)

        ctk.CTkLabel(
            self.tab_dsp,
            text="Suddivisione logica dei 32 canali DSP: USB Audio 16, Mixer 1 8 e Mixer 2 oppure S/PDIF.",
            anchor="w",
        ).pack(fill="x", padx=18, pady=(0, 4))

        scroll = ctk.CTkScrollableFrame(self.tab_dsp)
        scroll.pack(fill="both", expand=True, padx=10, pady=6)
        self.dsp_logical_scroll = scroll
        self.dsp_logical_rows = []
        self.dsp_input_routing = list(range(32))
        self.dsp_output_routing = list(range(32))
        self.dsp_last_group_mode = "Mixer 2"

        self.rebuild_logical_groups()

    def rebuild_logical_groups(self):
        for child in self.dsp_logical_scroll.winfo_children():
            child.destroy()
        self.dsp_logical_rows = []
        for group_name, group in DSP_LOGICAL_GROUPS.items():
            self.build_logical_group(self.dsp_logical_scroll, group_name, group)

    def build_logical_group(self, parent, group_name, group):
        group_frame = ctk.CTkFrame(parent)
        group_frame.pack(fill="x", padx=6, pady=6)

        title_row = ctk.CTkFrame(group_frame, fg_color="transparent")
        title_row.pack(fill="x", padx=8, pady=(6, 2))
        ctk.CTkLabel(title_row, text=group_name, font=("Arial", 13, "bold")).pack(side="left")

        input_endpoints = group["input_endpoints"]
        output_endpoints = group["output_endpoints"]
        input_options = group["inputs"]
        output_options = group["outputs"]
        if group_name == "Mixer 2 / S/PDIF":
            if self.dsp_last_group_mode == "S/PDIF":
                input_endpoints = group["spdif_input_endpoints"]
                output_endpoints = group["spdif_output_endpoints"]
            source_mode = ctk.StringVar(value="Mixer 2")
            source_mode.set(self.dsp_last_group_mode)
            ctk.CTkSegmentedButton(
                title_row,
                values=["Mixer 2", "S/PDIF"],
                variable=source_mode,
                command=self.on_last_group_mode_change,
            ).pack(side="right")

        header = ctk.CTkFrame(group_frame, fg_color="transparent")
        header.pack(fill="x", padx=8)
        ctk.CTkLabel(header, text="Canale", width=70, anchor="w").pack(side="left")
        ctk.CTkLabel(header, text="Input fisso", width=180, anchor="w").pack(side="left", padx=4)
        ctk.CTkLabel(header, text="Sorgente selezionata", width=250, anchor="w").pack(side="left", padx=4)
        ctk.CTkLabel(header, text="Output fisso", width=180, anchor="w").pack(side="left", padx=4)
        ctk.CTkLabel(header, text="Destinazione selezionata", width=250, anchor="w").pack(side="left", padx=4)

        rows = []
        start_index = len(self.dsp_logical_rows)
        channel_count = 2 if group_name == "Mixer 2 / S/PDIF" and self.dsp_last_group_mode == "S/PDIF" else group["count"]
        for channel in range(channel_count):
            row = ctk.CTkFrame(group_frame, fg_color="transparent")
            row.pack(fill="x", padx=8, pady=2)
            ctk.CTkLabel(row, text=f"{start_index + channel + 1:02}", width=70, anchor="w").pack(side="left")
            ctk.CTkLabel(row, text=input_endpoints[channel], width=180, anchor="w").pack(side="left", padx=4)
            input_menu = ctk.CTkOptionMenu(row, values=list(input_options), width=250)
            input_menu.set(list(input_options)[channel % len(input_options)])
            input_menu.pack(side="left", padx=4)
            ctk.CTkLabel(row, text=output_endpoints[channel], width=180, anchor="w").pack(side="left", padx=4)
            output_menu = ctk.CTkOptionMenu(row, values=list(output_options), width=250)
            output_menu.set(list(output_options)[channel % len(output_options)])
            output_menu.pack(side="left", padx=4)
            rows.append((input_menu, output_menu))
            self.dsp_logical_rows.append((input_menu, output_menu, input_options, output_options))

    def on_last_group_mode_change(self, mode):
        self.dsp_last_group_mode = mode
        self.rebuild_logical_groups()

    def send_dsp_logical_routing(self):
        input_routing = [input_options[input_menu.get()] for input_menu, _, input_options, _ in self.dsp_logical_rows]
        output_routing = [output_options[output_menu.get()] for _, output_menu, _, output_options in self.dsp_logical_rows]
        input_routing = (input_routing + self.dsp_input_routing[len(input_routing):])[:32]
        output_routing = (output_routing + self.dsp_output_routing[len(output_routing):])[:32]
        self.dsp_input_routing = input_routing
        self.dsp_output_routing = output_routing
        for dsp_id in range(4):
            start = dsp_id * 8
            self.send_sysex([0x40 + dsp_id] + input_routing[start:start + 8])
            self.send_sysex([0x50 + dsp_id] + output_routing[start:start + 8])

    # --- 3. TAB: DC BLOCKING & DC OFFSET (31H & 36H) ---
    def setup_dc_tab(self):
        container = ctk.CTkFrame(self.tab_dc)
        container.pack(fill="both", expand=True, padx=10, pady=10)

        # Left Section: HPF Filter switches (31H)
        hpf_box = ctk.CTkFrame(container)
        hpf_box.pack(side="left", fill="both", expand=True, padx=5, pady=5)

        ctk.CTkLabel(hpf_box, text="DC-Blocking Filters HPF (31H)", font=("Arial", 12, "bold")).pack(pady=10)
        ctk.CTkLabel(hpf_box, text="Attiva per bloccare la DC (Modalità Audio Passa-Alto)", font=("Arial", 10, "italic")).pack(pady=2)

        self.hpf_switches = []
        for i in range(14):
            sw = ctk.CTkSwitch(hpf_box, text=f"Input {i+1}", command=self.on_hpf_change)
            sw.pack(anchor="w", padx=20, pady=3)
            self.hpf_switches.append(sw)

        # Right Section: DC Offset per channel (36H)
        offset_box = ctk.CTkScrollableFrame(container)
        offset_box.pack(side="right", fill="both", expand=True, padx=5, pady=5)

        ctk.CTkLabel(offset_box, text="Set Channel DC Offset (36H)", font=("Arial", 12, "bold")).pack(pady=10)

        self.offset_entries = []
        for ch in range(14):
            row = ctk.CTkFrame(offset_box, fg_color="transparent")
            row.pack(fill="x", pady=3, padx=5)

            ctk.CTkLabel(row, text=f"Ch {ch+1}:", width=60, anchor="w").pack(side="left")

            slider = ctk.CTkSlider(row, from_=0, to=16383, command=lambda val, c=ch: self.on_dc_offset_slide(c, val))
            slider.set(8192)  # Zero offset
            slider.pack(side="left", expand=True, fill="x", padx=5)

            lbl = ctk.CTkLabel(row, text="8192", width=50)
            lbl.pack(side="right")
            self.offset_entries.append({"slider": slider, "label": lbl})

    def on_hpf_change(self):
        hpf_mask = 0
        for idx, sw in enumerate(self.hpf_switches):
            if sw.get():
                hpf_mask |= (1 << idx)
        # Invia comando 31H con bitmask
        self.send_sysex([0x31, hpf_mask & 0x7F, (hpf_mask >> 7) & 0x7F])

    def on_dc_offset_slide(self, channel, val):
        int_val = int(val)
        self.offset_entries[channel]["label"].configure(text=str(int_val))
        bytes3 = int_to_3bytes(int_val)
        # Comando 36H <channel> <3 bytes>
        self.send_sysex([0x36, channel] + bytes3)

    # --- 4. TAB: OPTIONS & MIDI (32H, 33H, 35H) ---
    def setup_options_tab(self):
        container = ctk.CTkFrame(self.tab_options)
        container.pack(fill="both", expand=True, padx=10, pady=10)

        # Global Options (32H)
        opt_box = ctk.CTkFrame(container)
        opt_box.pack(fill="x", padx=10, pady=10)

        ctk.CTkLabel(opt_box, text="Opzioni Generali Hardware (32H)", font=("Arial", 12, "bold")).pack(anchor="w", padx=10, pady=5)

        self.sw_mixer2 = ctk.CTkSwitch(opt_box, text="Usa Mixer 2 invece di S/PDIF (Bit 0)", command=self.on_options_change)
        self.sw_mixer2.pack(anchor="w", padx=20, pady=5)

        self.sw_midi_thru = ctk.CTkSwitch(opt_box, text="Abilita MIDI Thru (Bit 1)", command=self.on_options_change)
        self.sw_midi_thru.pack(anchor="w", padx=20, pady=5)

        # MIDI Channels Setup (35H)
        midi_box = ctk.CTkFrame(container)
        midi_box.pack(fill="x", padx=10, pady=10)

        ctk.CTkLabel(midi_box, text="Configurazione Canali MIDI (35H)", font=("Arial", 12, "bold")).pack(anchor="w", padx=10, pady=5)

        ch_row = ctk.CTkFrame(midi_box, fg_color="transparent")
        ch_row.pack(fill="x", padx=10, pady=5)

        ctk.CTkLabel(ch_row, text="USB MIDI Ch (1-16):").pack(side="left", padx=5)
        self.combo_usb_ch = ctk.CTkOptionMenu(ch_row, values=[str(i) for i in range(1, 17)])
        self.combo_usb_ch.set("1")
        self.combo_usb_ch.pack(side="left", padx=5)

        ctk.CTkLabel(ch_row, text="DIN MIDI Ch (1-16):").pack(side="left", padx=(20, 5))
        self.combo_din_ch = ctk.CTkOptionMenu(ch_row, values=[str(i) for i in range(1, 17)])
        self.combo_din_ch.set("1")
        self.combo_din_ch.pack(side="left", padx=5)

        btn_set_midi = ctk.CTkButton(ch_row, text="Set MIDI Ch", command=self.on_set_midi_channels)
        btn_set_midi.pack(side="left", padx=20)

    def on_options_change(self):
        opts = 0
        if self.sw_mixer2.get():
            opts |= 0x01
        if self.sw_midi_thru.get():
            opts |= 0x02
        # Comando 32H <options>
        self.send_sysex([0x32, opts])

    def on_set_midi_channels(self):
        usb_ch = int(self.combo_usb_ch.get()) - 1
        din_ch = int(self.combo_din_ch.get()) - 1
        # Comando 35H <USB MIDI channel> <DIN MIDI channel>
        self.send_sysex([0x35, usb_ch, din_ch])

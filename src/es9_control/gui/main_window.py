from __future__ import annotations

import mido
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSlider,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

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
    "USB Audio": (16, [f"USB Audio Input {i}" for i in range(1, 17)], [f"USB Audio Output {i}" for i in range(1, 17)]),
    "Mixer 1": (8, [f"Mixer 1 Input {i}" for i in range(8)], [f"Mixer 1 Output {i}" for i in range(8)]),
    "Mixer 2": (8, [f"Mixer 2 Input {i}" for i in range(8)], [f"Mixer 2 Output {i}" for i in range(8)]),
    "S/PDIF": (2, ["S/PDIF In L", "S/PDIF In R"], ["S/PDIF Out L", "S/PDIF Out R"]),
}


def int_to_3bytes(value: int) -> list[int]:
    value = max(0, min(0x1FFFFF, value))
    return [(value >> 14) & 0x7F, (value >> 7) & 0x7F, value & 0x7F]


class ES9TotalHardwareController(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Expert Sleepers ES-9 Hardware Control")
        self.resize(1100, 800)
        self.midi_output = None
        self.midi_input = None
        self._build_ui()
        self.refresh_midi_ports()

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.addWidget(self._build_connection_bar())
        root.addWidget(self._build_system_bar())
        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_matrix_tab(), "Matrix Mixer")
        self.tabs.addTab(self._build_dsp_tab(), "DSP Routing")
        self.tabs.addTab(self._build_dc_tab(), "DC Blocking & Offset")
        self.tabs.addTab(self._build_options_tab(), "Global Options & MIDI")
        root.addWidget(self.tabs)

    def _build_connection_bar(self):
        box = QGroupBox("MIDI")
        layout = QHBoxLayout(box)
        self.combo_out = QComboBox()
        self.combo_in = QComboBox()
        self.combo_out.currentTextChanged.connect(self.on_select_output)
        self.combo_in.currentTextChanged.connect(self.on_select_input)
        refresh = QPushButton("Refresh Ports")
        refresh.clicked.connect(self.refresh_midi_ports)
        self.status_label = QLabel("Disconnected")
        layout.addWidget(QLabel("Out"))
        layout.addWidget(self.combo_out, 1)
        layout.addWidget(QLabel("In"))
        layout.addWidget(self.combo_in, 1)
        layout.addWidget(refresh)
        layout.addWidget(self.status_label)
        return box

    def _build_system_bar(self):
        box = QWidget()
        layout = QHBoxLayout(box)
        actions = [("Save Standalone", [0x24, 0x00]), ("Save Hosted", [0x24, 0x01]), ("Restore", [0x25, 0x00]), ("Reset Defaults", [0x26]), ("Req Version", [0x22]), ("Req Rate", [0x2C])]
        for text, command in actions:
            button = QPushButton(text)
            button.clicked.connect(lambda checked=False, command=command: self.send_sysex(command))
            layout.addWidget(button)
        return box

    def _build_matrix_tab(self):
        page = QWidget()
        layout = QHBoxLayout(page)
        self.current_mix_id = 0
        self.mix_selector = QComboBox()
        self.mix_selector.addItems([f"Mix {i}" for i in range(16)])
        self.mix_selector.currentIndexChanged.connect(lambda value: setattr(self, "current_mix_id", value))
        controls = QFormLayout()
        controls.addRow("Mix", self.mix_selector)
        virtual = QSlider(Qt.Horizontal)
        virtual.setRange(0, 127)
        virtual.valueChanged.connect(lambda value: self.send_sysex([0x34, self.current_mix_id, value]))
        controls.addRow("Virtual mix", virtual)
        layout.addLayout(controls)
        for channel in range(8):
            slider = QSlider(Qt.Vertical)
            slider.setRange(0, 16383)
            slider.valueChanged.connect(lambda value, channel=channel: self.send_sysex([0x60 + self.current_mix_id, channel] + int_to_3bytes(value)))
            layout.addWidget(slider)
        return page

    def _build_dsp_tab(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        toolbar = QHBoxLayout()
        toolbar.addWidget(QLabel("Logical DSP routing"))
        toolbar.addStretch()
        send = QPushButton("Set routing")
        send.clicked.connect(self.send_dsp_logical_routing)
        toolbar.addWidget(send)
        layout.addLayout(toolbar)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        groups = QVBoxLayout(content)
        self.dsp_rows = []
        self.dsp_groups_layout = groups
        self.dsp_last_group_mode = "Mixer 2"
        channel = 0
        for group_name in ("USB Audio", "Mixer 1"):
            channel = self._add_dsp_group(groups, group_name, channel)
        self._add_dsp_group_selector(groups, channel)
        groups.addStretch()
        scroll.setWidget(content)
        layout.addWidget(scroll)
        return page

    def _add_dsp_group_selector(self, parent, start_channel):
        self.dsp_last_group_box = QGroupBox()
        group_layout = QVBoxLayout(self.dsp_last_group_box)
        self.dsp_last_group_layout = group_layout
        selector = QComboBox()
        selector.addItems(["Mixer 2", "S/PDIF"])
        selector.currentTextChanged.connect(self._change_dsp_last_group)
        self.dsp_last_group_selector = selector
        group_layout.addWidget(selector)
        self.dsp_last_group_rows = QWidget()
        group_layout.addWidget(self.dsp_last_group_rows)
        parent.addWidget(self.dsp_last_group_box)
        self._change_dsp_last_group("Mixer 2", start_channel)

    def _add_dsp_group(self, parent, group_name, start_channel):
        count, input_endpoints, output_endpoints = DSP_LOGICAL_GROUPS[group_name]
        group_box = QGroupBox(group_name)
        group_layout = QFormLayout(group_box)
        for index in range(count):
            row = QHBoxLayout()
            input_combo = QComboBox()
            output_combo = QComboBox()
            input_combo.addItems(DSP_INPUT_OPTIONS)
            output_combo.addItems(DSP_OUTPUT_OPTIONS)
            channel = start_channel + index
            input_combo.setCurrentIndex(channel % len(DSP_INPUT_OPTIONS))
            output_combo.setCurrentIndex(channel % len(DSP_OUTPUT_OPTIONS))
            row.addWidget(QLabel(input_endpoints[index]))
            row.addWidget(input_combo, 1)
            row.addWidget(QLabel(output_endpoints[index]))
            row.addWidget(output_combo, 1)
            group_layout.addRow(f"DSP {channel + 1:02}", row)
            self.dsp_rows.append((input_combo, output_combo))
        parent.addWidget(group_box)
        return start_channel + count

    def _change_dsp_last_group(self, mode, start_channel=None):
        if start_channel is None:
            start_channel = 24
        self.dsp_last_group_mode = mode
        old_rows = self.dsp_last_group_rows
        self.dsp_last_group_layout.removeWidget(old_rows)
        old_rows.deleteLater()
        count, input_endpoints, output_endpoints = DSP_LOGICAL_GROUPS[mode]
        rows_widget = QWidget()
        rows_layout = QFormLayout(rows_widget)
        for index in range(count):
            row = QHBoxLayout()
            input_combo = QComboBox()
            output_combo = QComboBox()
            input_combo.addItems(DSP_INPUT_OPTIONS)
            output_combo.addItems(DSP_OUTPUT_OPTIONS)
            channel = start_channel + index
            input_combo.setCurrentIndex(channel % len(DSP_INPUT_OPTIONS))
            output_combo.setCurrentIndex(channel % len(DSP_OUTPUT_OPTIONS))
            row.addWidget(QLabel(input_endpoints[index]))
            row.addWidget(input_combo, 1)
            row.addWidget(QLabel(output_endpoints[index]))
            row.addWidget(output_combo, 1)
            rows_layout.addRow(f"DSP {channel + 1:02}", row)
            if len(self.dsp_rows) > start_channel + index:
                self.dsp_rows[start_channel + index] = (input_combo, output_combo)
            else:
                self.dsp_rows.append((input_combo, output_combo))
        self.dsp_rows = self.dsp_rows[:start_channel + count]
        self.dsp_last_group_rows = rows_widget
        self.dsp_last_group_layout.addWidget(rows_widget)

    def _build_dc_tab(self):
        page = QWidget()
        layout = QHBoxLayout(page)
        hpf = QGroupBox("DC-blocking HPF")
        hpf_layout = QVBoxLayout(hpf)
        self.hpf_switches = []
        for index in range(14):
            button = QPushButton(f"Input {index + 1}")
            button.setCheckable(True)
            button.clicked.connect(self.on_hpf_change)
            hpf_layout.addWidget(button)
            self.hpf_switches.append(button)
        offsets = QGroupBox("DC Offset")
        offset_layout = QFormLayout(offsets)
        for channel in range(14):
            slider = QSlider(Qt.Horizontal)
            slider.setRange(0, 16383)
            slider.setValue(8192)
            slider.valueChanged.connect(lambda value, channel=channel: self.send_sysex([0x36, channel] + int_to_3bytes(value)))
            offset_layout.addRow(f"Ch {channel + 1}", slider)
        layout.addWidget(hpf)
        layout.addWidget(offsets)
        return page

    def _build_options_tab(self):
        page = QWidget()
        layout = QFormLayout(page)
        mixer2 = QPushButton("Mixer 2")
        mixer2.setCheckable(True)
        midi_thru = QPushButton("MIDI Thru")
        midi_thru.setCheckable(True)
        send_options = lambda: self.send_sysex([0x32, (1 if mixer2.isChecked() else 0) | (2 if midi_thru.isChecked() else 0)])
        mixer2.clicked.connect(send_options)
        midi_thru.clicked.connect(send_options)
        usb = QSpinBox()
        din = QSpinBox()
        usb.setRange(1, 16)
        din.setRange(1, 16)
        set_midi = QPushButton("Set MIDI channels")
        set_midi.clicked.connect(lambda: self.send_sysex([0x35, usb.value() - 1, din.value() - 1]))
        layout.addRow(mixer2)
        layout.addRow(midi_thru)
        layout.addRow("USB MIDI channel", usb)
        layout.addRow("DIN MIDI channel", din)
        layout.addRow(set_midi)
        return page

    def send_sysex(self, command):
        if self.midi_output:
            self.midi_output.send(mido.Message("sysex", data=SYSEX_HEADER + command))

    def refresh_midi_ports(self):
        outputs = mido.get_output_names()
        inputs = mido.get_input_names()
        self.combo_out.blockSignals(True)
        self.combo_in.blockSignals(True)
        self.combo_out.clear()
        self.combo_in.clear()
        self.combo_out.addItems(outputs)
        self.combo_in.addItems(inputs)
        self.combo_out.blockSignals(False)
        self.combo_in.blockSignals(False)
        if outputs:
            self.combo_out.setCurrentText(next((p for p in outputs if "ES-9" in p or "ES9" in p), outputs[0]))
            self.on_select_output(self.combo_out.currentText())
        if inputs:
            self.combo_in.setCurrentText(next((p for p in inputs if "ES-9" in p or "ES9" in p), inputs[0]))
            self.on_select_input(self.combo_in.currentText())

    def on_select_output(self, name):
        if not name:
            return
        if self.midi_output:
            self.midi_output.close()
        self.midi_output = mido.open_output(name)
        self.status_label.setText(f"Connected: OUT={name}")

    def on_select_input(self, name):
        if not name:
            return
        if self.midi_input:
            self.midi_input.close()
        self.midi_input = mido.open_input(name, callback=self.on_midi_receive)

    def on_midi_receive(self, message):
        if message.type == "sysex" and list(message.data[:4]) == SYSEX_HEADER:
            print(f"[ES-9 Response]: {list(message.data[4:])}")

    def on_hpf_change(self):
        mask = sum((1 << index) for index, button in enumerate(self.hpf_switches) if button.isChecked())
        self.send_sysex([0x31, mask & 0x7F, (mask >> 7) & 0x7F])

    def send_dsp_logical_routing(self):
        input_values = [DSP_INPUT_OPTIONS[combo.currentText()] for combo, _ in self.dsp_rows]
        output_values = [DSP_OUTPUT_OPTIONS[combo.currentText()] for _, combo in self.dsp_rows]
        for dsp_id in range(4):
            start = dsp_id * 8
            self.send_sysex([0x40 + dsp_id] + input_values[start:start + 8])
            self.send_sysex([0x50 + dsp_id] + output_values[start:start + 8])


def create_application():
    return QApplication.instance() or QApplication([])

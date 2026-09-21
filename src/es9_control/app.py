import sys
from es9_control.gui import ES9TotalHardwareController
from es9_control.gui.main_window import create_application

def main():
    app = create_application()
    window = ES9TotalHardwareController()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
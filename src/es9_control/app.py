import sys
from es9_control.gui import ES9TotalHardwareController

def main():
    app = ES9TotalHardwareController()
    sys.exit(app.mainloop())

if __name__ == "__main__":
    main()
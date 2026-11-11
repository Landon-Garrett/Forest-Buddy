import serial
import time
import csv


gps = serial.Serial("COM6", 9600, timeout=1)
data = []
start = time.time()
print("Collecting GNSS data for 120 seconds...")
while time.time() - start < 120:
    line = gps.readline().decode(
        "ascii", errors = "ignore"
        ).strip()
    if line.startswith(("$GNGGA", "$GPGGA")):
        parts = line.split(",")
        if len(parts) > 9 and parts[6] not in ("0",""):
            if parts[2] and parts[4]:
                lat = float(parts[2][:2]) + float(parts[2][2:]) / 60
                long = float(parts[4][:3]) + float(parts[4][3:]) / 60

                if parts[3] == "5":
                    lat = -lat
                if parts[5] == "W":
                        long = -long

                data.append([
                        time.time() - start,
                        lat,
                        long,
                        parts[6],
                        parts[7]
                        ])

gps.close()


with open("uncorrected150m.csv","w", newline="") as file:
                        writer = csv.writer(file)
                        writer.writerow([
                            "Time", "Latitude", "Longitude",
                            "Fix Quality", "Satellites"
                            ])
                        writer.writerows(data)

                        print("Collection Complete")
                        print("Valid measurements: ", len(data))
                        print("Saved to uncorrected150m.csv")

                                                   

import csv
import os
import time

# 1. Fixed file path inside your folder (rewrites this exact file each time)
folder_path = "C:/Temp/Pixhawk_IMU_Logs"
if not os.path.exists(folder_path):
    os.makedirs(folder_path)

output_file = os.path.join(folder_path, "pixhawk_imu_data.csv")

total_samples = 1000
sample_delay_ms = 50  # 50 ms = 20 Hz (1000 samples * 0.05s = 50 seconds)

print("Starting 50-second capture (1000 samples)...")

# mode="w" overwrites the single file cleanly with the new 1000 samples
with open(output_file, mode="w", newline="") as file:
    writer = csv.writer(file)
    writer.writerow([
        "Sample_Index",
        "Elapsed_Time (s)",
        "AccX (mG)",
        "AccY (mG)",
        "AccZ (mG)",
        "GyroX (deg/s)",
        "GyroY (deg/s)",
        "GyroZ (deg/s)",
        "Roll (deg)",
        "Pitch (deg)",
        "Yaw (deg)",
    ])

    start_time = time.time()

    for i in range(total_samples):
        elapsed = round(time.time() - start_time, 3)

        writer.writerow([
            i + 1,
            elapsed,
            cs.ax,
            cs.ay,
            cs.az,
            cs.gx,
            cs.gy,
            cs.gz,
            cs.roll,
            cs.pitch,
            cs.yaw,
        ])

        # Print progress every 100 samples (every 5 seconds)
        if (i + 1) % 100 == 0:
            print(
                "Recorded {}/{} samples ({:.1f}s)".format(
                    i + 1, total_samples, elapsed
                )
            )

        Script.Sleep(sample_delay_ms)

print("Capture complete! Opening in Excel...")

# Automatically launch the file in Excel once all 1000 samples are saved
os.startfile(output_file)

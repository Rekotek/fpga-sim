// Урок 10, практика 3: цвет WS2812 с клавиатуры Mac по UART.
// Буквы r g b y c m w выбирают цвет, цифры 0..9 — яркость (0 — погасить).
// Эхо — как в уроке 9: набранное видно в picocom.
// Три модуля без единой правки: uart_rx, uart_tx (урок 9) и ws2812_tx.
module top #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk
    parameter integer BAUD   = 115_200      // скорость UART
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       uart_rx,  // UART: от Mac через BL616 к ПЛИС, вывод 70
    output wire       uart_tx,  // UART: от ПЛИС к BL616 и в Mac, вывод 69
    output wire       ws2812    // линия данных WS2812, вывод 79
);
    wire [7:0] rx_data;
    wire       rx_valid;

    uart_rx #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) rx0 (
        .clk   (clk),
        .rx    (uart_rx),
        .data  (rx_data),
        .valid (rx_valid)
    );

    uart_tx #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) tx0 (
        .clk   (clk),
        .start (rx_valid),          // эхо
        .data  (rx_data),
        .tx    (uart_tx),
        .busy  ()
    );

    // Какие каналы включены: {красный, зелёный, синий}. После прошивки — белый.
    reg [2:0] mask  = 3'b111;
    // Яркость 0..9. После прошивки — 1 (тускло: видно, что схема жива).
    reg [3:0] level = 4'd1;

    always @(posedge clk) begin
        if (rx_valid) begin                     // команда — один раз на байт
            case (rx_data)
                "r":     mask <= 3'b100;        // красный
                "g":     mask <= 3'b010;        // зелёный
                "b":     mask <= 3'b001;        // синий
                "y":     mask <= 3'b110;        // жёлтый = красный + зелёный
                "c":     mask <= 3'b011;        // голубой = зелёный + синий
                "m":     mask <= 3'b101;        // пурпурный = красный + синий
                "w":     mask <= 3'b111;        // белый = все три
                default: if (rx_data >= "0" && rx_data <= "9")
                             level <= rx_data[3:0];   // цифра: младшие 4 бита кода
            endcase
        end
    end

    wire [7:0] bright = level * 8'd28;          // 0, 28, …, 252 (как в задании урока 9)

    ws2812_tx #(.CLK_HZ(CLK_HZ)) led0 (
        .clk   (clk),
        .start (1'b1),
        .r     (mask[2] ? bright : 8'd0),
        .g     (mask[1] ? bright : 8'd0),
        .b     (mask[0] ? bright : 8'd0),
        .dout  (ws2812),
        .busy  ()
    );
endmodule

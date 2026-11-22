// Урок 9, практика 4: команды с Mac. Клавиши 1..6 переключают LED0..LED5,
// клавиша 0 гасит все. Каждый принятый символ плата отправляет обратно (эхо),
// чтобы в терминале было видно, что набрано.
module top #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk; тестбенч ставит меньше
    parameter integer BAUD   = 115_200      // скорость UART; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       uart_rx,  // UART: от Mac через BL616 к ПЛИС, вывод 70
    output wire       uart_tx,  // UART: от ПЛИС к BL616 и в Mac, вывод 69
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
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

    // Какие светодиоды включены: 1 = горит.
    reg [5:0] on = 6'b000000;

    always @(posedge clk) begin
        if (rx_valid) begin             // байт пришёл — один такт на решение
            case (rx_data)
                "0":     on    <= 6'b000000;    // погасить все
                "1":     on[0] <= ~on[0];       // переключить LED0
                "2":     on[1] <= ~on[1];
                "3":     on[2] <= ~on[2];
                "4":     on[3] <= ~on[3];
                "5":     on[4] <= ~on[4];
                "6":     on[5] <= ~on[5];
                default: on    <= on;           // другие символы — без изменений
            endcase
        end
    end

    assign led = ~on;
endmodule

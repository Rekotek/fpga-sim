// Урок 9, практика 3: эхо. Каждый байт, пришедший с Mac, плата сразу
// отправляет обратно. LED0..LED5 показывают младшие 6 бит последнего байта.
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
        .start (rx_valid),          // приняли байт — сразу отправляем
        .data  (rx_data),
        .tx    (uart_tx),
        .busy  ()                   // выход не нужен — оставляем пустым
    );

    assign led = ~rx_data[5:0];
endmodule
